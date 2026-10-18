"""Test doubles for the agent server: a scripted Strands model and a recording browser bridge."""
import json
from typing import Any

from strands.models.model import Model


class ScriptedModel(Model):
    """Replays scripted assistant turns instead of calling a provider.

    Each turn is a list of parts: ("text", str) or ("tool", name, input_dict).
    `seen` records what the agent sent on every call.
    """

    def __init__(self, turns: list[list[tuple]]):
        self.turns = list(turns)
        self.seen: list[dict[str, Any]] = []

    def update_config(self, **model_config: Any) -> None:
        pass

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted"}

    async def structured_output(self, *args: Any, **kwargs: Any):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.seen.append(
            {"messages": messages, "tools": [t["name"] for t in tool_specs or []], "system": system_prompt}
        )
        turn = self.turns.pop(0)
        yield {"messageStart": {"role": "assistant"}}
        stop = "end_turn"
        for i, part in enumerate(turn):
            if part[0] == "text":
                yield {"contentBlockStart": {"start": {}}}
                yield {"contentBlockDelta": {"delta": {"text": part[1]}}}
                yield {"contentBlockStop": {}}
            else:
                stop = "tool_use"
                yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": f"tu{i}", "name": part[1]}}}}
                yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(part[2])}}}}
                yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": stop}}


def tool_results(model: ScriptedModel, call: int) -> list[dict]:
    """The toolResult blocks the agent sent to the model on call number `call` (0-based)."""
    return [b["toolResult"] for msg in model.seen[call]["messages"] for b in msg["content"] if "toolResult" in b]


class RecordingBridge:
    """Stands in for BrowserBridge: records calls and answers with `results[name]` (default: echo args)."""

    def __init__(self, results: dict[str, Any] | None = None, fail: dict[str, str] | None = None):
        self.calls: list[tuple[str, dict]] = []
        self.results = results or {}
        self.fail = fail or {}

    async def call(self, name: str, args: dict, timeout_s: float = 10.0) -> Any:
        from jarvis_neuro.agent.bridge import BrowserToolError

        self.calls.append((name, args))
        if name in self.fail:
            raise BrowserToolError(self.fail[name])
        return self.results.get(name, args)
