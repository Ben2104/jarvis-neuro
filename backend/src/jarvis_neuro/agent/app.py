"""FastAPI app: the agent WebSocket at /ws, a health check, and the built viewer (spec decision 7).

Run: uv run uvicorn jarvis_neuro.agent.app:app --port 8000
"""
import asyncio
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from strands.models.model import Model

from .bridge import BrowserBridge
from .cases import REPO_ROOT, CaseRepo
from .config import AgentSettings, ConfigError, allowed_origins, build_model, load_settings
from .orchestrator import OrchestratorSession
from .protocol import CLIENT_MESSAGE, CaseMessage, ToolResultMessage, UserMessage
from .reasoner import make_explainer
from .tools import SceneContext

log = logging.getLogger(__name__)
DEFAULT_STATIC_DIR = REPO_ROOT / "frontend" / "dist"
ModelBuilder = Callable[[AgentSettings, str], Model]


def create_app(
    *,
    settings_loader: Callable[[], AgentSettings] = load_settings,
    model_builder: ModelBuilder = build_model,
    repo: CaseRepo | None = None,
    static_dir: Path | None = DEFAULT_STATIC_DIR,
) -> FastAPI:
    app = FastAPI(title="Jarvis-Neuro agent")
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    cases = repo or CaseRepo()

    def agent_state() -> tuple[AgentSettings | None, str | None]:
        try:
            return settings_loader(), None
        except ConfigError as e:
            return None, str(e)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        settings, problem = agent_state()
        return {"ok": True, "agent": "ready" if settings else "unavailable", "detail": problem}

    @app.websocket("/ws")
    async def agent_socket(socket: WebSocket) -> None:
        origin = socket.headers.get("origin")
        if origin is not None and origin not in allowed_origins():
            await socket.close(code=1008)
            return
        await socket.accept()
        send_lock = asyncio.Lock()
        disconnected = False

        async def send(msg: dict[str, Any]) -> None:
            nonlocal disconnected
            async with send_lock:
                if disconnected:
                    return
                try:
                    await socket.send_json(msg)
                except (RuntimeError, WebSocketDisconnect, OSError):
                    disconnected = True

        settings, problem = agent_state()
        bridge = BrowserBridge(send)
        ctx = SceneContext(bridge=bridge, repo=cases)
        session = None
        if settings:
            try:
                session = OrchestratorSession(
                    ctx,
                    model_builder(settings, settings.orchestrator_model),
                    make_explainer(model_builder(settings, settings.reasoner_model)),
                )
            except Exception as e:
                problem = str(e)
        await send({"type": "status", "state": "ready" if session else "unavailable", "detail": problem})

        async def run_turn(msg: UserMessage) -> None:
            try:
                await send({"type": "busy", "busy": True})
                text = await session.ask(msg.text)
                await send({"type": "reply", "turn_id": msg.turn_id, "text": text})
            except asyncio.CancelledError:
                raise
            except Exception as e:  # provider down, quota, bad key: tell the user, keep the socket
                log.exception("agent turn failed")
                await send({"type": "error", "turn_id": msg.turn_id, "message": f"agent failed: {e}"})
            finally:
                if not disconnected and not asyncio.current_task().cancelling():
                    await send({"type": "busy", "busy": False})

        turns: set[asyncio.Task[None]] = set()
        try:
            while True:
                try:
                    raw = await socket.receive_text()
                    msg = CLIENT_MESSAGE.validate_json(raw)
                except (ValueError, KeyError) as e:
                    detail = "binary frames are not supported; send JSON text" if isinstance(e, KeyError) else str(e)
                    await send({"type": "error", "turn_id": None, "message": f"bad message: {detail}"})
                    continue
                if isinstance(msg, ToolResultMessage):
                    bridge.resolve(msg.model_dump())
                elif isinstance(msg, CaseMessage):
                    try:
                        ctx.set_case(msg.case_id, msg.provenance)
                    except (ValueError, OSError) as e:
                        ctx.manifest = None
                        await send({"type": "error", "turn_id": None, "message": f"case sync failed: {e}"})
                elif session is None:
                    await send({"type": "error", "turn_id": msg.turn_id, "message": f"agent unavailable: {problem}"})
                elif any(not task.done() for task in turns):
                    await send({
                        "type": "error", "turn_id": msg.turn_id,
                        "message": "busy: a turn is already running",
                    })
                else:
                    task = asyncio.create_task(run_turn(msg))
                    turns.add(task)
                    task.add_done_callback(turns.discard)
        except WebSocketDisconnect:
            pass
        finally:
            disconnected = True
            bridge.close("the browser disconnected")
            pending = tuple(turns)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    if static_dir is not None and static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="viewer")
    return app


app = create_app()
