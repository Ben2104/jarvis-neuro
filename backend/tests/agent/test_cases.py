import json

import pytest

from jarvis_neuro.agent.cases import DEFAULT_CASES_DIR, CaseRepo, case_summary, hemisphere_of


@pytest.fixture
def repo():
    return CaseRepo(DEFAULT_CASES_DIR)


def test_default_cases_dir_is_the_committed_viewer_cases():
    assert (DEFAULT_CASES_DIR / "index.json").is_file()


def test_entry_without_provenance_is_the_first_in_index_order(repo):
    first = next(e for e in repo.index().cases if e.case_id == "synth_001")
    assert repo.entry("synth_001") == first


def test_entry_rejects_unknown_case_and_provenance(repo):
    with pytest.raises(ValueError, match=r"unknown case_id 'nope'; expected one of .*synth_001"):
        repo.entry("nope")
    with pytest.raises(ValueError, match="no case synth_001 with provenance ground-truth; available: synthetic"):
        repo.entry("synth_001", "ground-truth")


def test_case_summary_uses_manifest_values_only(repo):
    m = repo.manifest(repo.entry("synth_001", "synthetic"))
    s = case_summary(m)
    assert s["case_id"] == "synth_001" and s["provenance"] == "synthetic"
    assert s["dims"] == [56, 64, 48] and s["midline_x_ras"] == 0.0 and s["dice_vs_gt"] is None
    assert [a["id"] for a in s["assets"]] == ["brain_surface", "tumor_et", "tumor_ncr", "tumor_ed"]
    assert s["assets"][0] == {"id": "brain_surface", "kind": "surface"}
    et = s["assets"][1]
    assert et["volume_ml"] == 13.014
    assert et["centroid_ras"] == [-24.0, 18.0, 3.0]
    assert et["hemisphere"] == "left"
    json.dumps(s)  # the tool result must be JSON


def test_hemisphere_uses_ras_x_against_the_midline():
    assert hemisphere_of(-1.0, 0.0) == "left"
    assert hemisphere_of(1.0, 0.0) == "right"
    assert hemisphere_of(0.0, 0.0) == "midline"
