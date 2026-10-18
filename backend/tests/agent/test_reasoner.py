import asyncio
import json

from agent_fakes import ScriptedModel

from jarvis_neuro.agent.cases import DEFAULT_CASES_DIR, CaseRepo
from jarvis_neuro.agent.reasoner import (
    ATLAS_ANSWER,
    REASONER_PROMPT,
    case_facts,
    make_explainer,
    reasoner_input,
)


def _synth():
    repo = CaseRepo(DEFAULT_CASES_DIR)
    return repo.manifest(repo.entry("synth_001"))


def test_prompt_carries_the_scripted_atlas_answer_and_the_no_invention_rule():
    assert ATLAS_ANSWER in REASONER_PROMPT
    assert "atlas registration" in ATLAS_ANSWER
    assert "Never estimate or invent a number" in REASONER_PROMPT


def test_case_facts_are_manifest_values_only():
    facts = case_facts(_synth())
    assert facts["case_id"] == "synth_001" and facts["provenance"] == "synthetic"
    assert facts["dice_vs_gt"] is None
    et = facts["tumour_sub_regions"][0]
    assert et == {
        "id": "tumor_et",
        "meaning": "enhancing tumor (MSD label 3)",
        "volume_ml": 13.014,
        "centroid_ras": [-24.0, 18.0, 3.0],
        "bbox_ras": [[-39.0, 3.0, -12.0], [-9.0, 33.0, 18.0]],
        "hemisphere": "left",
        "min_dist_surface_mm": et["min_dist_surface_mm"],
    }
    assert [t["id"] for t in facts["tumour_sub_regions"]] == ["tumor_et", "tumor_ncr", "tumor_ed"]


def test_input_holds_the_question_and_parseable_facts():
    text = reasoner_input("Which side is it on?", _synth())
    assert text.startswith("QUESTION: Which side is it on?")
    assert json.loads(text.split("CASE FACTS:\n", 1)[1])["case_id"] == "synth_001"


def test_explainer_runs_a_fresh_reasoner_with_the_prompt_and_no_tools():
    model = ScriptedModel([[("text", "Left hemisphere.")], [("text", "13.0 mL.")]])
    explain = make_explainer(model)
    m = _synth()
    assert asyncio.run(explain("Which side?", m)) == "Left hemisphere."
    assert asyncio.run(explain("How big?", m)) == "13.0 mL."
    assert model.seen[0]["system"] == REASONER_PROMPT and model.seen[0]["tools"] == []
    # Fresh agent: the second call does not carry the first question.
    assert len(model.seen[1]["messages"]) == 1
