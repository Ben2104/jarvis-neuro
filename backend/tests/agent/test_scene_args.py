import pytest

from jarvis_neuro.agent.cases import DEFAULT_CASES_DIR, CaseRepo
from jarvis_neuro.agent.scene_args import (
    check_asset_ids,
    clamp,
    clamp_cut_mm,
    clamp_slice_index,
    ras_extent,
)


@pytest.fixture
def synth():
    repo = CaseRepo(DEFAULT_CASES_DIR)
    return repo.manifest(repo.entry("synth_001"))


def test_unknown_asset_ids_are_rejected_with_the_known_list(synth):
    assert check_asset_ids(synth, ["tumor_et", "brain_surface"]) == ["tumor_et", "brain_surface"]
    with pytest.raises(ValueError, match="unknown asset_id 'motor_strip'; expected one of brain_surface, tumor_et"):
        check_asset_ids(synth, ["tumor_et", "motor_strip"])
    with pytest.raises(ValueError, match="must not be empty"):
        check_asset_ids(synth, [])


def test_clamp():
    assert clamp(1.7, 0, 1) == 1 and clamp(-0.2, 0, 1) == 0 and clamp(0.4, 0, 1) == 0.4


def test_ras_extent_of_synth(synth):
    # vox2ras = diag(3,3,3) + (-81,-96,-72); dims 56,64,48
    assert ras_extent(synth) == ([-81.0, -96.0, -72.0], [84.0, 93.0, 69.0])


def test_cut_mm_clamps_to_the_volume_along_the_plane_axis(synth):
    assert clamp_cut_mm(synth, "sagittal", 500) == 84.0
    assert clamp_cut_mm(synth, "coronal", -500) == -96.0
    assert clamp_cut_mm(synth, "axial", 3.5) == 3.5


def test_slice_index_rounds_half_up_and_clamps(synth):
    assert clamp_slice_index(synth, "axial", 24.5) == 25
    assert clamp_slice_index(synth, "axial", 99) == 47
    assert clamp_slice_index(synth, "sagittal", -3) == 0
    assert clamp_slice_index(synth, "coronal", 63.2) == 63
