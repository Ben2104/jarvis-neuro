"""WebSocket messages from the browser, validated with pydantic. Server messages are plain dicts:

{"type": "status", "state": "ready" | "unavailable", "detail": str | None}
{"type": "busy", "busy": bool}
{"type": "tool_call", "id": str, "name": str, "args": dict}
{"type": "reply", "turn_id": str, "text": str}
{"type": "error", "turn_id": str | None, "message": str}
"""
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserMessage(_Msg):
    type: Literal["user"]
    turn_id: Annotated[str, Field(min_length=1, max_length=64)]
    text: Annotated[str, Field(min_length=1, max_length=2000)]


class ToolResultMessage(_Msg):
    type: Literal["tool_result"]
    id: str
    ok: bool
    result: Any = None
    error: str | None = None


class CaseMessage(_Msg):
    """The case the viewer shows, sent on connect and whenever it changes (keyboard, gestures or the agent)."""

    type: Literal["case"]
    case_id: str
    provenance: str


ClientMessage = Annotated[Union[UserMessage, ToolResultMessage, CaseMessage], Field(discriminator="type")]
CLIENT_MESSAGE = TypeAdapter(ClientMessage)
