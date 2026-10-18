"""Scene tool calls travel to the browser over the WebSocket and come back as tool results (spec §5 Transport)."""
import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

Send = Callable[[dict[str, Any]], Awaitable[None]]
DEFAULT_TIMEOUT_S = 10.0


class BrowserToolError(ValueError):
    """The browser refused or failed a tool call. Strands returns it to the Orchestrator as an error result."""


class BrowserBridge:
    def __init__(self, send: Send):
        self._send = send
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._closed: str | None = None

    async def call(self, name: str, args: dict[str, Any], timeout_s: float = DEFAULT_TIMEOUT_S) -> Any:
        """Run one tool in the browser. Returns its result, or raises BrowserToolError."""
        if self._closed:
            raise BrowserToolError(self._closed)
        call_id = f"srv-{uuid.uuid4().hex[:12]}"
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[call_id] = future
        try:
            await self._send({"type": "tool_call", "id": call_id, "name": name, "args": args})
            reply = await asyncio.wait_for(future, timeout_s)
        except TimeoutError:
            raise BrowserToolError(f"the browser did not answer {name} within {timeout_s:g} s") from None
        finally:
            self._pending.pop(call_id, None)
        if reply.get("ok"):
            return reply.get("result")
        raise BrowserToolError(str(reply.get("error") or f"{name} failed in the browser"))

    def resolve(self, reply: dict[str, Any]) -> bool:
        """Deliver a tool_result from the browser. False if no call is waiting for that id."""
        future = self._pending.get(str(reply.get("id")))
        if future is None or future.done():
            return False
        future.set_result(reply)
        return True

    def close(self, reason: str) -> None:
        """Fail every waiting call, and every later one, with `reason`."""
        self._closed = reason
        for future in self._pending.values():
            if not future.done():
                future.set_exception(BrowserToolError(reason))
        self._pending.clear()
