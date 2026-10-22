import nibabel as nib
import numpy as np
import pytest
from study_fakes import open_uploads, synthetic_upload

from jarvis_neuro.agent import studies
from jarvis_neuro.agent.studies import read_sequences, remap_brats_to_msd, save_uploads, to_case
from jarvis_neuro.io_msd import load_msd_case
from jarvis_neuro.synthetic import SYNTH_NAME


def test_remap_maps_brats_labels_to_msd():
    seg = np.array([0, 1, 2, 4], np.uint8)
    assert remap_brats_to_msd(seg).tolist() == [0, 2, 1, 3]


def test_remap_rejects_an_unexpected_label():
    with pytest.raises(ValueError, match="unexpected label 3 in seg.nii.gz"):
        remap_brats_to_msd(np.array([0, 1, 3]))


def test_save_uploads_requires_every_sequence(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")
    uploads = open_uploads(files)
    uploads["flair"] = None
    with pytest.raises(ValueError, match="^flair: file is required$"):
        save_uploads(tmp_path / "s", uploads)


def test_save_uploads_rejects_other_extensions(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")
    uploads = open_uploads(files)
    uploads["t2"] = ("t2.dcm", uploads["t2"][1])
    with pytest.raises(ValueError, match="^t2: expected a .nii or .nii.gz file$"):
        save_uploads(tmp_path / "s", uploads)


def test_save_uploads_caps_the_total_size(tmp_path, monkeypatch):
    files, _ = synthetic_upload(tmp_path / "in")
    monkeypatch.setattr(studies, "MAX_UPLOAD_MB", 0)
    with pytest.raises(studies.UploadTooLarge):
        save_uploads(tmp_path / "s", open_uploads(files))


def test_read_sequences_rejects_a_shape_mismatch_naming_the_field(tmp_path):
    files, _ = synthetic_upload(tmp_path)
    img = nib.load(files["t1"])
    nib.save(nib.Nifti1Image(np.asarray(img.dataobj)[:-1], img.affine), files["t1"])
    with pytest.raises(ValueError, match="^t1: shape"):
        read_sequences(files)


def test_read_sequences_rejects_an_affine_mismatch_naming_the_field(tmp_path):
    files, _ = synthetic_upload(tmp_path)
    img = nib.load(files["t2"])
    moved = img.affine.copy()
    moved[0, 3] += 5
    nib.save(nib.Nifti1Image(np.asarray(img.dataobj), moved), files["t2"])
    with pytest.raises(ValueError, match="^t2: affine does not match t1c$"):
        read_sequences(files)


def test_read_sequences_rejects_an_unreadable_file(tmp_path):
    files, _ = synthetic_upload(tmp_path)
    files["flair"].write_bytes(b"not a nifti")
    with pytest.raises(ValueError, match="^flair: not a readable NIfTI$"):
        read_sequences(files)


def test_to_case_matches_the_msd_loader(tmp_path):
    files, _ = synthetic_upload(tmp_path)
    case = to_case("study_abc", read_sequences(files))
    ref = load_msd_case(tmp_path / "msd", SYNTH_NAME)
    assert case.case_id == "study_abc"
    assert case.modalities == {"flair": 0, "t1w": 1, "t1gd": 2, "t2w": 3}
    np.testing.assert_array_equal(case.image, ref.image)
    np.testing.assert_allclose(case.vox2ras, ref.vox2ras)
