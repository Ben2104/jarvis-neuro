import numpy as np

from jarvis_neuro.io_msd import load_msd_case
from jarvis_neuro.labels import ED, ET, NCR
from jarvis_neuro.stats import centroid_ras, midline_x_ras
from jarvis_neuro.synthetic import SYNTH_NAME, SYNTH_SHAPE, make_synthetic_msd


def test_synthetic_case_loads_canonical(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path), SYNTH_NAME)
    A = case.vox2ras
    assert case.case_id == "synth_001"
    assert (np.diag(A)[:3] > 0).all()                          # RAS after canonicalisation
    assert np.allclose(A[:3, :3], np.diag(np.diag(A)[:3]))
    assert case.image.shape == (*SYNTH_SHAPE, 4)
    assert set(case.modalities) == {"flair", "t1w", "t1gd", "t2w"}
    assert set(np.unique(case.labels).tolist()) == {0, ED, NCR, ET}


def test_synthetic_tumor_is_in_left_hemisphere(tmp_path):
    # Written with +i = left (LAS). A loader that drops the flip would put it on the right.
    case = load_msd_case(make_synthetic_msd(tmp_path), SYNTH_NAME)
    brain = (case.image != 0).any(-1)
    assert centroid_ras(case.labels > 0, case.vox2ras)[0] < midline_x_ras(brain, case.vox2ras)


def test_tumor_lies_inside_brain(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path), SYNTH_NAME)
    brain = (case.image != 0).any(-1)
    assert brain[case.labels > 0].all()
