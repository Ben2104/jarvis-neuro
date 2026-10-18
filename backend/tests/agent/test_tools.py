import asyncio

import pytest
from agent_fakes import RecordingBridge

from jarvis_neuro.agent.bridge import BrowserToolError
from jarvis_neuro.agent.cases import DEFAULT_CASES_DIR, CaseRepo
from jarvis_neuro.agent.tools import SceneContext, make_tools

SPEC_TOOLS = [
    "load_case",
    "set_opacity",
    "focus_region",
    "set_cutaway",
    "hide_hemisphere",
    "set_explode",
    "toggle_visibility",
    "inspect_mri_slice",
    "explain",
]


async def _no_explainer(question, manifest):
    raise AssertionError("explain should not run")


def _setup(loaded=True, **bridge_kw):
    bridge = RecordingBridge(**bridge_kw)
    ctx = SceneContext(bridge=bridge, repo=CaseRepo(DEFAULT_CASES_DIR))
    if loaded:
        ctx.set_case("synth_001", None)
    tools = {t.tool_name: t for t in make_tools(ctx, _no_explainer)}
    return ctx, bridge, tools


def run(coro):
    return asyncio.run(coro)


def test_the_tool_set_is_exactly_spec_section_5():
    _, _, tools = _setup()
    assert list(tools) == SPEC_TOOLS


def test_load_case_resolves_the_default_provenance_and_returns_the_manifest_summary():
    ctx, bridge, tools = _setup(loaded=False)
    summary = run(tools["load_case"]("synth_001"))
    assert bridge.calls == [("load_case", {"case_id": "synth_001", "provenance": "synthetic"})]
    assert summary["case_id"] == "synth_001" and summary["assets"][1]["volume_ml"] == 13.014
    assert ctx.manifest is not None and ctx.manifest.case_id == "synth_001"


def test_load_case_rejects_an_unknown_case_before_the_browser_sees_it():
    _, bridge, tools = _setup(loaded=False)
    with pytest.raises(ValueError, match="unknown case_id 'msd_042'"):
        run(tools["load_case"]("msd_042"))
    assert bridge.calls == []


def test_load_case_keeps_the_previous_case_when_the_browser_fails():
    ctx, _, tools = _setup(fail={"load_case": "could not load synth_001: HTTP 404"})
    before = ctx.manifest
    with pytest.raises(BrowserToolError, match="HTTP 404"):
        run(tools["load_case"]("synth_001"))
    assert ctx.manifest is before


def test_scene_tools_need_a_case():
    _, bridge, tools = _setup(loaded=False)
    with pytest.raises(ValueError, match="no case loaded; call load_case first"):
        run(tools["set_explode"](0.5))
    assert bridge.calls == []


def test_unknown_asset_ids_never_reach_the_browser():
    _, bridge, tools = _setup()
    with pytest.raises(ValueError, match="unknown asset_id 'motor_strip'"):
        run(tools["set_opacity"]("motor_strip", 0.5))
    with pytest.raises(ValueError, match="unknown asset_id 'lobe'"):
        run(tools["toggle_visibility"](["tumor_et", "lobe"], False))
    with pytest.raises(ValueError, match="unknown asset_id 'x'"):
        run(tools["focus_region"]("x"))
    assert bridge.calls == []


def test_numbers_are_clamped_before_forwarding():
    _, bridge, tools = _setup()
    run(tools["set_opacity"]("tumor_et", 3))
    run(tools["set_explode"](-1))
    run(tools["set_cutaway"]("sagittal", 900))
    run(tools["inspect_mri_slice"]("axial", 400))
    assert bridge.calls == [
        ("set_opacity", {"asset_id": "tumor_et", "value": 1}),
        ("set_explode", {"value": 0}),
        ("set_cutaway", {"plane": "sagittal", "ras_mm": 84.0}),
        ("inspect_mri_slice", {"axis": "axial", "index": 47}),
    ]


def test_cutaway_none_needs_no_position_and_others_do():
    _, bridge, tools = _setup()
    run(tools["set_cutaway"]("none"))
    assert bridge.calls == [("set_cutaway", {"plane": "none"})]
    with pytest.raises(ValueError, match="ras_mm is required unless plane is none"):
        run(tools["set_cutaway"]("axial"))


def test_the_browser_result_is_the_tool_result():
    _, _, tools = _setup(results={"inspect_mri_slice": {"axis": "axial", "index": 25, "labels_present": [1, 2, 3]}})
    assert run(tools["inspect_mri_slice"]("axial", 25))["labels_present"] == [1, 2, 3]


def test_hide_hemisphere_and_toggle_forward_their_args():
    _, bridge, tools = _setup()
    run(tools["hide_hemisphere"]("left"))
    run(tools["toggle_visibility"](["brain_surface"], False))
    assert bridge.calls == [
        ("hide_hemisphere", {"side": "left"}),
        ("toggle_visibility", {"asset_ids": ["brain_surface"], "visible": False}),
    ]


def test_explain_passes_the_question_and_the_loaded_manifest():
    seen = []

    async def explainer(question, manifest):
        seen.append((question, manifest.case_id))
        return "13.0 mL"

    bridge = RecordingBridge()
    ctx = SceneContext(bridge=bridge, repo=CaseRepo(DEFAULT_CASES_DIR))
    tools = {t.tool_name: t for t in make_tools(ctx, explainer)}
    with pytest.raises(ValueError, match="no case loaded"):
        run(tools["explain"]("how big?"))
    ctx.set_case("synth_001", None)
    assert run(tools["explain"]("how big?")) == "13.0 mL"
    assert seen == [("how big?", "synth_001")] and bridge.calls == []
