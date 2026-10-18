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


def test_non_json_text_keeps_socket_open():
    with _client(ScriptedModel([[('text', 'alive')]])).websocket_connect('/ws') as ws:
        ws.receive_json()
        ws.send_text('not json')
        error = ws.receive_json()
        assert error['type'] == 'error' and error['turn_id'] is None
        assert error['message'].startswith('bad message: ')
        ws.send_json({'type': 'user', 'turn_id': 'next', 'text': 'hello'})
        assert _until(ws, 'reply')['text'] == 'alive'


def test_binary_frame_keeps_socket_open():
    with _client(ScriptedModel([[('text', 'alive')]])).websocket_connect('/ws') as ws:
        ws.receive_json()
        ws.send_bytes(b'{}')
        error = ws.receive_json()
        assert error['type'] == 'error' and error['turn_id'] is None
        assert error['message'].startswith('bad message: ')
        ws.send_json({'type': 'user', 'turn_id': 'next', 'text': 'hello'})
        assert _until(ws, 'reply')['text'] == 'alive'


def test_evil_origin_is_rejected(monkeypatch):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.delenv('AGENT_ALLOWED_ORIGINS', raising=False)
    with pytest.raises(WebSocketDisconnect) as exc:
        with _client(ScriptedModel([])).websocket_connect('/ws', headers={'origin': 'https://evil.example'}):
            pass
    assert exc.value.code == 1008


def test_localhost_origin_is_accepted(monkeypatch):
    monkeypatch.delenv('AGENT_ALLOWED_ORIGINS', raising=False)
    with _client(ScriptedModel([])).websocket_connect('/ws', headers={'origin': 'http://localhost:5173'}) as ws:
        assert ws.receive_json()['state'] == 'ready'


def test_no_origin_is_accepted(monkeypatch):
    monkeypatch.setenv('AGENT_ALLOWED_ORIGINS', 'https://trusted.example')
    with _client(ScriptedModel([])).websocket_connect('/ws') as ws:
        assert ws.receive_json()['state'] == 'ready'


def test_origin_allowlist_from_env(monkeypatch):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setenv('AGENT_ALLOWED_ORIGINS', ' https://trusted.example , https://second.example ')
    with _client(ScriptedModel([])).websocket_connect('/ws', headers={'origin': 'https://trusted.example'}) as ws:
        assert ws.receive_json()['state'] == 'ready'
    with pytest.raises(WebSocketDisconnect) as exc:
        with _client(ScriptedModel([])).websocket_connect('/ws', headers={'origin': 'http://localhost:5173'}):
            pass
    assert exc.value.code == 1008


def test_overlapping_turn_is_rejected_with_one_busy_pair():
    model = ScriptedModel([[('tool', 'set_explode', {'value': 1})], [('text', 'done')]])
    with _client(model).websocket_connect('/ws') as ws:
        ws.receive_json()
        ws.send_json({'type': 'case', 'case_id': 'synth_001', 'provenance': 'synthetic'})
        ws.send_json({'type': 'user', 'turn_id': 'a', 'text': 'explode'})
        ws.send_json({'type': 'user', 'turn_id': 'b', 'text': 'again'})
        ws.send_json({'type': 'dance'})
        messages = []
        while (not any(m.get('message', '').startswith('bad message: ') for m in messages)
               or not any(m['type'] == 'tool_call' for m in messages)):
            messages.append(ws.receive_json())
        call = next(m for m in messages if m['type'] == 'tool_call')
        assert next((m for m in messages if m.get('turn_id') == 'b'), None) == {
            'type': 'error', 'turn_id': 'b', 'message': 'busy: a turn is already running',
        }
        ws.send_json({'type': 'tool_result', 'id': call['id'], 'ok': True, 'result': {}})
        while not any(m == {'type': 'busy', 'busy': False} for m in messages):
            messages.append(ws.receive_json())
        assert [m['busy'] for m in messages if m['type'] == 'busy'] == [True, False]
        assert [m['turn_id'] for m in messages if m['type'] == 'reply'] == ['a']
        ws.send_json({'type': 'dance'})
        assert ws.receive_json()['message'].startswith('bad message: ')


def test_model_builder_failure_reports_unavailable():
    def broken_builder(settings, model_id):
        raise RuntimeError('builder failed')

    app = create_app(settings_loader=lambda: SETTINGS, model_builder=broken_builder, static_dir=None)
    with TestClient(app).websocket_connect('/ws') as ws:
        assert ws.receive_json() == {'type': 'status', 'state': 'unavailable', 'detail': 'builder failed'}
        ws.send_json({'type': 'user', 'turn_id': 'a', 'text': 'hello'})
        assert ws.receive_json() == {'type': 'error', 'turn_id': 'a', 'message': 'agent unavailable: builder failed'}


def test_disconnect_awaits_turn_and_preserves_cancellation(monkeypatch):
    import asyncio
    import json
    from jarvis_neuro.agent.orchestrator import OrchestratorSession

    async def main():
        events = asyncio.Queue()
        for event in [
            {'type': 'websocket.connect'},
            {'type': 'websocket.receive', 'text': json.dumps({'type': 'user', 'turn_id': 'a', 'text': 'hello'})},
        ]:
            events.put_nowait(event)
        closed = False
        cancelled = asyncio.Event()
        turn_tasks = []

        async def ask(self, text):
            turn_tasks.append(asyncio.current_task())
            events.put_nowait({'type': 'websocket.disconnect', 'code': 1000})
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        monkeypatch.setattr(OrchestratorSession, 'ask', ask)

        async def receive():
            nonlocal closed
            event = await events.get()
            if event['type'] == 'websocket.disconnect':
                closed = True
            return event

        async def send(event):
            if closed:
                raise RuntimeError('socket already closed')

        scope = {'type': 'websocket', 'path': '/ws', 'raw_path': b'/ws', 'query_string': b'',
                 'headers': [], 'scheme': 'ws', 'server': ('test', 80), 'client': ('test', 123),
                 'subprotocols': [], 'root_path': ''}
        app = _client(ScriptedModel([])).app
        await app(scope, receive, send)
        assert cancelled.is_set(), 'disconnect must await turn cancellation'
        assert len(turn_tasks) == 1 and turn_tasks[0].cancelled()

    asyncio.run(main())
