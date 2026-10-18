# jarvis-neuro backend

Python 3.11–3.13 (3.12 tested), managed with `uv`. Two parts:

- `jarvis_neuro` (bake): turns MSD cases into the files the viewer loads. See `docs/superpowers/plans/2026-10-17-bake-pipeline.md`.
- `jarvis_neuro.agent`: the agent server. FastAPI hosts the Strands Orchestrator and the Clinical Reasoner, talks to the viewer over one WebSocket (`/ws`), and serves `frontend/dist` when it exists.

Educational visualization. Not for diagnosis or surgical planning.

## Run the agent server

```bash
uv sync
export MODEL_PROVIDER=anthropic          # or gemini
export ANTHROPIC_API_KEY=...             # or GEMINI_API_KEY
# Anthropic defaults: ORCHESTRATOR_MODEL=claude-haiku-5-5, REASONER_MODEL=claude-sonnet-5-5
# Gemini has no defaults: set both ORCHESTRATOR_MODEL and REASONER_MODEL.
uv run uvicorn jarvis_neuro.agent.app:app --port 8000
```

Then either run the viewer dev server (`cd ../frontend && npm run dev`, which proxies `/ws` and `/api` to port 8000) or build it (`npm run build`) and open http://localhost:8000/.

Without a valid provider config the server still starts: `GET /api/health` and the viewer's Agent chip say `unavailable` and give the reason. Mouse, keyboard and gestures work either way.

`CASES_DIR` overrides where cases are read from (default `../frontend/public/cases`). It must match what the browser loads.

The WebSocket only accepts browser connections whose `Origin` is in `AGENT_ALLOWED_ORIGINS` (comma-separated; default `http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000`). Entries and the incoming Origin are compared after stripping whitespace, removing trailing slashes and lowercasing; empty entries are dropped. Connections without an `Origin` header (scripts, tests) are allowed. With the default allowlist, a rejected origin — including `null` from a `file://` page, a LAN address such as `http://10.0.0.5:5173`, or Vite's fallback port 5174 — gets HTTP 403 at the handshake, which the browser reports as close code 1006, and the viewer keeps showing "Agent offline · retrying". Add the origin to `AGENT_ALLOWED_ORIGINS` to fix it. (The tests see this as close code 1008 because the test client reports a rejected handshake that way.)

## How a turn works

1. The browser sends `{type:"user", turn_id, text}`.
2. The Orchestrator picks tools. Scene tools validate and clamp their arguments against the loaded manifest, then send `{type:"tool_call", id, name, args}` to the browser.
3. The browser runs the call through the same `executeTool` the keyboard uses and answers `{type:"tool_result", id, ok, result|error}`. Errors go back to the model as tool errors.
4. `explain` asks the Clinical Reasoner, which sees the question plus the manifest facts and nothing else.
5. The server sends `{type:"reply", turn_id, text}`; the browser shows it and speaks it when "Speak replies" is enabled and speech synthesis is available.

One turn runs at a time per connection. A `user` message during a running turn gets `{type:"error", turn_id, message:"busy: a turn is already running"}`. A malformed message gets a one-line `bad message: ...` error and the socket stays open. Other errors: `agent unavailable: <reason>` when no valid provider is configured, `agent failed: ...` when the model call fails, and `case sync failed: ...` when a `case` message names a case that cannot be read.

The browser must answer each tool call within 10 s (30 s for `load_case`); otherwise the model gets "the browser did not answer ..." as the tool error.

The message table is in `src/jarvis_neuro/agent/protocol.py`.

## Tests

```bash
uv run pytest -q
```

The agent tests use `tests/agent/agent_fakes.py`: a scripted Strands model and a recording browser bridge. They make no network calls.
