import asyncio

import pytest

from jarvis_neuro.agent.bridge import BrowserBridge, BrowserToolError


class Browser:
    """Collects what the bridge sends; the test answers by calling bridge.resolve."""

    def __init__(self):
        self.sent: list[dict] = []

    async def send(self, msg: dict) -> None:
        self.sent.append(msg)


async def _next_call(browser: Browser, n: int = 1) -> dict:
    while len(browser.sent) < n:
        await asyncio.sleep(0)
    return browser.sent[n - 1]


def test_call_sends_a_tool_call_and_returns_the_browser_result():
    async def main():
        browser = Browser()
        bridge = BrowserBridge(browser.send)
        task = asyncio.create_task(bridge.call("set_opacity", {"asset_id": "tumor_et", "value": 0.5}))
        msg = await _next_call(browser)
        assert msg["type"] == "tool_call" and msg["name"] == "set_opacity"
        assert msg["args"] == {"asset_id": "tumor_et", "value": 0.5}
        assert msg["id"].startswith("srv-")
        assert bridge.resolve({"type": "tool_result", "id": msg["id"], "ok": True, "result": {"value": 0.5}})
        assert await task == {"value": 0.5}

    asyncio.run(main())


def test_a_browser_error_becomes_browser_tool_error():
    async def main():
        browser = Browser()
        bridge = BrowserBridge(browser.send)
        task = asyncio.create_task(bridge.call("focus_region", {"asset_id": "x"}))
        msg = await _next_call(browser)
        bridge.resolve({"id": msg["id"], "ok": False, "error": "no case loaded; call load_case first"})
        with pytest.raises(BrowserToolError, match="no case loaded"):
            await task

    asyncio.run(main())


def test_timeout_names_the_tool():
    async def main():
        bridge = BrowserBridge(Browser().send)
        with pytest.raises(BrowserToolError, match="did not answer set_explode within 0.01 s"):
            await bridge.call("set_explode", {"value": 1}, timeout_s=0.01)

    asyncio.run(main())


def test_unknown_or_repeated_ids_are_ignored():
    async def main():
        browser = Browser()
        bridge = BrowserBridge(browser.send)
        assert not bridge.resolve({"id": "srv-nope", "ok": True})
        task = asyncio.create_task(bridge.call("set_explode", {"value": 1}))
        msg = await _next_call(browser)
        assert bridge.resolve({"id": msg["id"], "ok": True, "result": 1})
        assert not bridge.resolve({"id": msg["id"], "ok": True, "result": 2})
        assert await task == 1

    asyncio.run(main())


def test_close_fails_waiting_and_later_calls():
    async def main():
        browser = Browser()
        bridge = BrowserBridge(browser.send)
        task = asyncio.create_task(bridge.call("set_explode", {"value": 1}))
        await _next_call(browser)
        bridge.close("browser disconnected")
        with pytest.raises(BrowserToolError, match="browser disconnected"):
            await task
        with pytest.raises(BrowserToolError, match="browser disconnected"):
            await bridge.call("set_explode", {"value": 0})

    asyncio.run(main())
