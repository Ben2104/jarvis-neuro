import time

import nibabel as nib
import numpy as np
from fastapi.testclient import TestClient
from study_fakes import brats_segmenter, synthetic_upload

from jarvis_neuro.agent import studies
from jarvis_neuro.agent.app import create_app
from jarvis_neuro.agent.cases import CaseRepo
from jarvis_neuro.agent.config import AgentSettings
from jarvis_neuro.agent.studies import StudyRunner

SETTINGS = AgentSettings("anthropic", "orch", "reason", "key")


def _client(tmp_path, segment) -> TestClient:
    runner = StudyRunner(segment, cases_root=lambda: tmp_path / "cases", work_root=tmp_path / "work")
    app = create_app(settings_loader=lambda: SETTINGS, model_builder=lambda s, m: None,
                     repo=CaseRepo(tmp_path / "cases"), studies=runner, static_dir=None)
    return TestClient(app)


def _form(files):
    return {name: (path.name, path.read_bytes()) for name, path in files.items()}


def _wait(client, study_id, timeout=60.0):
    deadline = time.monotonic() + timeout
    while True:
        body = client.get(f"/api/studies/{study_id}").json()
        if body["status"] in ("done", "failed") or time.monotonic() > deadline:
            return body
        time.sleep(0.05)


def test_upload_runs_to_a_baked_case(tmp_path):
    files, labels = synthetic_upload(tmp_path / "in")
    client = _client(tmp_path, brats_segmenter(labels))
    r = client.post("/api/studies", files=_form(files))
    assert r.status_code == 202
    study_id = r.json()["study_id"]
    assert len(study_id) == 12 and int(study_id, 16) >= 0
    body = _wait(client, study_id)
    assert body["status"] == "done", body
    assert body["case_id"] == f"study_{study_id}"
    assert (tmp_path / "cases" / f"study_{study_id}" / "monai-segresnet" / "manifest.json").exists()


def test_segmentation_failure_fails_the_study_at_segment(tmp_path):
    files, _ = synthetic_upload(tmp_path / "in")

    def broken(files, dest):
        raise RuntimeError("segmentation service unreachable at http://localhost:8001")

    client = _client(tmp_path, broken)
    body = _wait(client, client.post("/api/studies", files=_form(files)).json()["study_id"])
    assert body["status"] == "failed"
    assert body["step"] == "segment"
    assert body["error"] == "segmentation service unreachable at http://localhost:8001"


def test_missing_field_is_a_400_naming_it(tmp_path):
    files, labels = synthetic_upload(tmp_path / "in")
    form = _form(files)
    del form["flair"]
    r = _client(tmp_path, brats_segmenter(labels)).post("/api/studies", files=form)
    assert r.status_code == 400
    assert r.json() == {"detail": "flair: file is required"}


def test_affine_mismatch_is_a_400_naming_the_field(tmp_path):
    files, labels = synthetic_upload(tmp_path / "in")
    img = nib.load(files["t2"])
    moved = img.affine.copy()
    moved[1, 3] += 4
    nib.save(nib.Nifti1Image(np.asarray(img.dataobj), moved), files["t2"])
    r = _client(tmp_path, brats_segmenter(labels)).post("/api/studies", files=_form(files))
    assert r.status_code == 400
    assert r.json() == {"detail": "t2: affine does not match t1c"}
    assert not any((tmp_path / "work").iterdir())


def test_over_the_cap_is_a_413(tmp_path, monkeypatch):
    files, labels = synthetic_upload(tmp_path / "in")
    monkeypatch.setattr(studies, "MAX_UPLOAD_MB", 0)
    r = _client(tmp_path, brats_segmenter(labels)).post("/api/studies", files=_form(files))
    assert r.status_code == 413


def test_unknown_study_is_a_404(tmp_path):
    files, labels = synthetic_upload(tmp_path / "in")
    assert _client(tmp_path, brats_segmenter(labels)).get("/api/studies/000000000000").status_code == 404
