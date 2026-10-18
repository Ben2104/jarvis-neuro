from agent_fakes import ScriptedModel, tool_results
from fastapi.testclient import TestClient

from jarvis_neuro.agent.app import create_app
from jarvis_neuro.agent.cases import DEFAULT_CASES_DIR, CaseRepo
from jarvis_neuro.agent.config import AgentSettings, ConfigError
from jarvis_neuro.agent.orchestrator import ORCHESTRATOR_PROMPT

SETTINGS = AgentSettings("anthropic", "orch", "reason", "key")


def _client(orchestrator: ScriptedModel, reasoner: ScriptedModel | None = None, static_dir=None) -> TestClient:
    models = {"orch": orchestrator, "reason": reasoner or ScriptedModel([])}
    app = create_app(
        settings_loader=lambda: SETTINGS,
        model_builder=lambda settings, model_id: models[model_id],
        repo=CaseRepo(DEFAULT_CASES_DIR),
        static_dir=static_dir,
    )
    return TestClient(app)


def _until(ws, kind: str) -> dict:
    while True:
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg


def test_a_turn_forwards_tool_calls_to_the_browser_and_replies():
    model = ScriptedModel(
        [
            [("tool", "set_explode", {"value": 2})],
            [("text", "Pulled apart.")],
        ]
    )
    with _client(model).websocket_connect("/ws") as ws:
        assert ws.receive_json() == {"type": "status", "state": "ready", "detail": None}
        ws.send_json({"type": "case", "case_id": "synth_001", "provenance": "synthetic"})
        ws.send_json({"type": "user", "turn_id": "u1", "text": "pull it apart"})
        assert ws.receive_json() == {"type": "busy", "busy": True}
        call = _until(ws, "tool_call")
        assert call["name"] == "set_explode" and call["args"] == {"value": 1}
        ws.send_json({"type": "tool_result", "id": call["id"], "ok": True, "result": {"value": 1}})
        assert _until(ws, "reply") == {"type": "reply", "turn_id": "u1", "text": "Pulled apart."}
        assert ws.receive_json() == {"type": "busy", "busy": False}
    assert model.seen[0]["system"] == ORCHESTRATOR_PROMPT
    assert "explain" in model.seen[0]["tools"]
    assert tool_results(model, 1)[-1]["status"] == "success"


def test_a_browser_error_goes_back_to_the_model_as_an_error_result():
    model = ScriptedModel([[("tool", "set_explode", {"value": 1})], [("text", "I could not do that.")]])
    with _client(model).websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "case", "case_id": "synth_001", "provenance": "synthetic"})
        ws.send_json({"type": "user", "turn_id": "u1", "text": "explode"})
        call = _until(ws, "tool_call")
        ws.send_json({"type": "tool_result", "id": call["id"], "ok": False, "error": "WebGL lost"})
        assert _until(ws, "reply")["text"] == "I could not do that."
    result = tool_results(model, 1)[-1]
    assert result["status"] == "error" and "WebGL lost" in result["content"][0]["text"]


def test_without_a_case_message_scene_tools_fail_without_reaching_the_browser():
    model = ScriptedModel([[("tool", "set_explode", {"value": 1})], [("text", "Load a case first.")]])
    with _client(model).websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "user", "turn_id": "u1", "text": "explode"})
        assert ws.receive_json() == {"type": "busy", "busy": True}
        assert ws.receive_json()["type"] == "reply"
    assert "no case loaded" in tool_results(model, 1)[-1]["content"][0]["text"]


def test_explain_reaches_the_reasoner_with_manifest_facts():
    orchestrator = ScriptedModel([[("tool", "explain", {"question": "how big is it"})], [("text", "13.0 mL.")]])
    reasoner = ScriptedModel([[("text", "The enhancing tumor is 13.0 mL.")]])
    with _client(orchestrator, reasoner).websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "case", "case_id": "synth_001", "provenance": "synthetic"})
        ws.send_json({"type": "user", "turn_id": "u1", "text": "how big is it"})
        assert _until(ws, "reply")["text"] == "13.0 mL."
    question = reasoner.seen[0]["messages"][0]["content"][0]["text"]
    assert question.startswith("QUESTION: how big is it") and '"volume_ml": 13.014' in question
    assert tool_results(orchestrator, 1)[-1]["content"][0]["text"] == "The enhancing tumor is 13.0 mL."


def test_bad_messages_and_unknown_cases_are_reported_not_fatal():
    with _client(ScriptedModel([[("text", "hi")]])).websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "dance"})
        assert ws.receive_json()["message"].startswith("bad message")
        ws.send_json({"type": "case", "case_id": "nope", "provenance": "synthetic"})
        assert "case sync failed: unknown case_id 'nope'" in ws.receive_json()["message"]
        ws.send_json({"type": "user", "turn_id": "u1", "text": "hello"})
        assert _until(ws, "reply")["text"] == "hi"


def test_unconfigured_provider_reports_unavailable_and_keeps_the_socket():
    def no_settings():
        raise ConfigError("MODEL_PROVIDER must be one of gemini, anthropic; got ''")

    app = create_app(settings_loader=no_settings, repo=CaseRepo(DEFAULT_CASES_DIR), static_dir=None)
    client = TestClient(app)
    assert client.get("/api/health").json()["agent"] == "unavailable"
    with client.websocket_connect("/ws") as ws:
        status = ws.receive_json()
        assert status["state"] == "unavailable" and "MODEL_PROVIDER" in status["detail"]
        ws.send_json({"type": "user", "turn_id": "u1", "text": "hello"})
        assert ws.receive_json() == {
            "type": "error",
            "turn_id": "u1",
            "message": "agent unavailable: MODEL_PROVIDER must be one of gemini, anthropic; got ''",
        }


def test_a_failing_model_reports_an_error_and_ends_the_turn():
    class Broken(ScriptedModel):
        async def stream(self, *args, **kwargs):
            raise RuntimeError("quota exceeded")
            yield

    with _client(Broken([])).websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "user", "turn_id": "u1", "text": "hello"})
        err = _until(ws, "error")
        assert err["turn_id"] == "u1" and "quota exceeded" in err["message"]
        assert ws.receive_json() == {"type": "busy", "busy": False}


def test_the_built_viewer_is_served_when_present(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>viewer</title>")
    client = _client(ScriptedModel([]), static_dir=tmp_path)
    assert "viewer" in client.get("/").text
    assert client.get("/api/health").json()["ok"] is True
