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


import httpx
from study_fakes import brats_segmenter

from jarvis_neuro.agent.studies import SegResNetClient, Study, StudyRunner
from jarvis_neuro.manifest import CaseIndex, Manifest


def _runner(tmp_path, segment):
    return StudyRunner(segment, cases_root=lambda: tmp_path / "cases", work_root=tmp_path / "work")


def test_run_bakes_a_viewer_case(tmp_path):
    files, labels = synthetic_upload(tmp_path / "in")
    calls = []
    runner = _runner(tmp_path, brats_segmenter(labels, calls))
    study = Study("abcdef012345", tmp_path / "work" / "abcdef012345", files)
    study.workdir.mkdir(parents=True)
    runner.run(study)
    view = study.view()
    assert view["status"] == "done", view
    assert view["case_id"] == "study_abcdef012345"
    assert [view["steps"][s]["state"] for s in ("read", "volume", "segment", "measure")] == ["done"] * 4
    assert view["steps"]["volume"]["dims"] == [56, 64, 48]
    assert view["steps"]["volume"]["spacing_mm"] == [3.0, 3.0, 3.0]
    assert calls == [files]
    out = tmp_path / "cases" / "study_abcdef012345" / "monai-segresnet"
    m = Manifest.model_validate_json((out / "manifest.json").read_text())
    assert m.provenance == "monai-segresnet"
    mask = np.fromfile(out / "mask_u8.bin", np.uint8)
    assert set(np.unique(mask).tolist()) <= {0, 1, 2, 3}
    ref = load_msd_case(tmp_path / "in" / "msd", SYNTH_NAME).labels
    assert np.bincount(mask, minlength=4).tolist() == np.bincount(ref.ravel(), minlength=4).tolist()
    idx = CaseIndex.model_validate_json((tmp_path / "cases" / "index.json").read_text())
    assert [(e.case_id, e.path) for e in idx.cases] == [
        ("study_abcdef012345", "study_abcdef012345/monai-segresnet/manifest.json")
    ]


def test_run_fails_at_segment_with_one_line(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")

    def broken(files, dest):
        raise RuntimeError("segmentation service unreachable at http://x:1\ntraceback noise")

    study = Study("abcdef012345", tmp_path / "work" / "abcdef012345", files)
    _runner(tmp_path, broken).run(study)
    view = study.view()
    assert view["status"] == "failed"
    assert view["step"] == "segment"
    assert view["steps"]["segment"]["state"] == "failed"
    assert view["steps"]["measure"]["state"] == "pending"
    assert view["error"] == "segmentation service unreachable at http://x:1"


def _segresnet(tmp_path, statuses, seg_bytes=b"SEG"):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(202, json={"job_id": "j1"})
        if request.url.path == "/jobs/j1":
            return httpx.Response(200, json=statuses.pop(0))
        return httpx.Response(200, content=seg_bytes)

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://seg"), seen


def test_client_posts_polls_and_downloads(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")
    http, seen = _segresnet(tmp_path, [{"status": "running"}, {"status": "done"}])
    sleeps = []
    SegResNetClient("http://seg", http=http, sleep=sleeps.append)(files, tmp_path / "seg.nii.gz")
    assert (tmp_path / "seg.nii.gz").read_bytes() == b"SEG"
    assert seen == [("POST", "/jobs"), ("GET", "/jobs/j1"), ("GET", "/jobs/j1"), ("GET", "/jobs/j1/seg.nii.gz")]
    assert sleeps == [2.0]


def test_client_reports_a_failed_job(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")
    http, _ = _segresnet(tmp_path, [{"status": "failed", "error": "CUDA out of memory"}])
    with pytest.raises(RuntimeError, match="^CUDA out of memory$"):
        SegResNetClient("http://seg", http=http, sleep=lambda s: None)(files, tmp_path / "seg.nii.gz")


def test_client_reports_an_unreachable_service(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")

    def refuse(request):
        raise httpx.ConnectError("refused")

    http = httpx.Client(transport=httpx.MockTransport(refuse))
    with pytest.raises(RuntimeError, match="^segmentation service unreachable at http://seg$"):
        SegResNetClient("http://seg/", http=http)(files, tmp_path / "seg.nii.gz")
