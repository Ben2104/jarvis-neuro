import json

import nibabel as nib
import numpy as np
import pytest

from jarvis_neuro.io_msd import load_msd_case
from jarvis_neuro.labels import ED, ET, NCR
from jarvis_neuro.stats import centroid_ras, midline_x_ras
from jarvis_neuro.synthetic import DATASET_JSON, SYNTH_NAME, SYNTH_SHAPE, make_synthetic_msd


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


def write_small_case(root, image_shape=(4, 5, 6, 4), label_shape=(4, 5, 6), label_affine=None):
    (root / "imagesTr").mkdir()
    (root / "labelsTr").mkdir()
    (root / "dataset.json").write_text(json.dumps(DATASET_JSON))
    nib.save(nib.Nifti1Image(np.ones(image_shape, np.float32), np.eye(4)),
             root / "imagesTr" / "SMALL.nii.gz")
    nib.save(nib.Nifti1Image(np.zeros(label_shape, np.uint8),
                            np.eye(4) if label_affine is None else label_affine),
             root / "labelsTr" / "SMALL.nii.gz")


@pytest.mark.parametrize("shape", [(4, 5, 6), (4, 5, 6, 3)])
def test_rejects_invalid_image_shape(tmp_path, shape):
    write_small_case(tmp_path, image_shape=shape)
    with pytest.raises(ValueError, match="MSD_SHAPE:"):
        load_msd_case(tmp_path, "SMALL")


@pytest.mark.parametrize("shape", [(1, 5, 6), (4, 5, 7), (4, 5, 6, 1)])
def test_rejects_mismatched_label_shape(tmp_path, shape):
    write_small_case(tmp_path, label_shape=shape)
    with pytest.raises(ValueError, match="MSD_SHAPE_MISMATCH:"):
        load_msd_case(tmp_path, "SMALL")


def test_rejects_mismatched_label_affine(tmp_path):
    affine = np.eye(4)
    affine[0, 3] = 10.0
    write_small_case(tmp_path, label_affine=affine)
    with pytest.raises(ValueError, match="MSD_AFFINE_MISMATCH:"):
        load_msd_case(tmp_path, "SMALL")
