# NeuroVision Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload four NIfTI sequences, segment them with the SegResNet service, bake a viewer case, and walk the four NeuroVision Figma screens (Upload → Processing → MRI Workspace → 3D), all runnable with one `docker compose up`.

**Architecture:** The agent server (`jarvis_neuro.agent`, :8000) gains a study API that saves the upload, forwards it to SegResNet (:8001), remaps BraTS labels to MSD, and calls the existing `bake_case` into `CASES_DIR`. The viewer gains a `stage` in its zustand store and four screens; MPR moves from one `slice` to three `slices`. A multi-stage `backend/Dockerfile` serves the built viewer from the agent server; root `compose.yaml` runs `segresnet` + `app`.

**Tech Stack:** FastAPI, httpx, nibabel, numpy, pytest (backend); React 19, TypeScript, zustand, zod, vitest (frontend); Docker Compose; uv; npm.

**Spec:** `docs/superpowers/specs/2026-10-21-neurovision-flow-design.md`. Read it first.

## Global Constraints

- Educational visualization. Not for diagnosis or surgical planning. The footer disclaimer stays on every screen.
- Upload is exactly four NIfTI files: fields `t1c`, `t1`, `t2`, `flair`; extensions `.nii` / `.nii.gz`; total ≤ 250 MB.
- Study id: 12 lowercase hex. Baked case id: `study_<study_id>` (manifest `case_id` must match `^[a-z0-9_]+$`). Cases bake into `CASES_DIR/study_<id>/monai-segresnet/`.
- Label remap BraTS → MSD: `{0→0, 1→2, 2→1, 4→3}`; any other value fails with `unexpected label <n> in seg.nii.gz`.
- MSD channel order `[FLAIR, T1, T1gd, T2]` with modality keys `flair`, `t1w`, `t1gd`, `t2w` (`bake.py` reads `flair`, `cortex.py` reads `t1w`).
- `SEGRESNET_URL` defaults to `http://localhost:8001`.
- Only computed values are shown. Atlas-only fields read exactly `Requires atlas — not in this build`.
- Header tabs Explore, Learning Mode, Help render disabled. Vision and Spatial UI agent chips are placeholders.
- `backend/segresnet_api/src` is not edited.
- Commits: each pane commits only its own paths with an explicit pathspec (`git commit -m "..." -- <paths>`). Never `git add -A`, never `git add .`. Never commit `frontend/public/cases/index.json` with `study_` entries.
- GitNexus (see `CLAUDE.md`): run `impact` on a symbol before editing it; run `detect_changes` before every commit.

## Panes and ownership

| Pane | Owns | Tasks |
|---|---|---|
| backend | `backend/` except `backend/segresnet_api/src`; `compose.yaml`; `.dockerignore`; `.env.example`; `.gitignore` | B1 → B2 → B3 → B4 |
| frontend | `frontend/` | F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 |
| QA | `scripts/qa/` (read-only everywhere else) | Q1 first, Q2 after B3, Q3 after B4 + F8 |

Cross-pane contract: the Study API JSON in spec §2. Frontend develops against it with a mocked `fetchFn`; it does not wait for the backend.

## File map

| File | Pane | Responsibility |
|---|---|---|
| `backend/src/jarvis_neuro/synthetic.py` (modify) | backend | `write_synthetic_study(root)`: the synthetic case as four upload-style NIfTIs |
| `backend/src/jarvis_neuro/agent/studies.py` (new) | backend | Validation, label remap, SegResNet client, study table + worker |
| `backend/src/jarvis_neuro/agent/app.py` (modify) | backend | `POST /api/studies`, `GET /api/studies/{id}` |
| `backend/tests/agent/study_fakes.py` (new) | backend | Synthetic upload + fake SegResNet for tests |
| `backend/tests/agent/test_studies.py` (new) | backend | Unit tests for `studies.py` |
| `backend/tests/agent/test_studies_api.py` (new) | backend | Route tests |
| `backend/Dockerfile`, `compose.yaml`, `.dockerignore`, `.env.example`, `.gitignore` | backend | Container stack |
| `frontend/src/lib/studies.ts` (new) | frontend | Study schema, `postStudy`, `getStudy`, filename matcher |
| `frontend/src/state/store.ts` (modify) | frontend | `stage`, study state, `slices` / `activeAxis`, `focusPoint`, `openCase` |
| `frontend/src/ui/UploadScreen.tsx` (new) | frontend | Screen 01 |
| `frontend/src/ui/ProcessingScreen.tsx` (new) | frontend | Screen 02 |
| `frontend/src/ui/Workspace.tsx`, `DatasetCard.tsx` (new) | frontend | Screen 03 |
| `frontend/src/ui/Explore3D.tsx` (new) | frontend | Screen 04 |
| `frontend/src/ui/MriPanel.tsx`, `FindingsPanel.tsx`, `AgentConsole.tsx`, `Header.tsx`, `theme.css`, `layout.css` (modify) | frontend | Restyle + MPR |
| `frontend/src/App.tsx`, `main.tsx` (modify) | frontend | Stage switch; boot at Upload |
| `scripts/qa/check.sh`, `scripts/qa/e2e.sh` (new) | QA | Test gate; compose end-to-end |

---

## Backend pane

### Task B1: Study core — remap, validation, volume

**Files:**
- Modify: `backend/src/jarvis_neuro/synthetic.py`
- Create: `backend/src/jarvis_neuro/agent/studies.py`
- Create: `backend/tests/agent/study_fakes.py`
- Test: `backend/tests/agent/test_studies.py`

**Interfaces:**
- Produces: `SEQUENCES`, `MSD_CHANNELS`, `BRATS_TO_MSD`, `STEPS`, `PROVENANCE`, `MAX_UPLOAD_MB`, `UploadTooLarge(ValueError)`, `remap_brats_to_msd(seg) -> np.ndarray`, `save_uploads(dest, uploads) -> dict[str, Path]`, `read_sequences(files) -> dict[str, nib.Nifti1Image]`, `to_case(case_id, images) -> LoadedCase`, `load_seg(path, case) -> np.ndarray`; `write_synthetic_study(root) -> dict[str, Path]`; test helpers `synthetic_upload(tmp) -> (files, labels_path)`, `brats_segmenter(labels_path)`, `open_uploads(files)`.

- [ ] **Step 1: Impact check**

Run GitNexus `impact({target: "make_synthetic_msd", direction: "upstream"})`. Adding a sibling function does not change it; report LOW and continue.

- [ ] **Step 2: Add `write_synthetic_study` to `synthetic.py`** (append at the end)

```python
SYNTH_STUDY_CHANNELS = {"flair": 0, "t1": 1, "t1c": 2, "t2": 3}


def write_synthetic_study(root: Path) -> dict[str, Path]:
    """The synthetic case as four 3D NIfTIs named like an upload, on the raw LAS grid.
    Its labels stay at root/msd/labelsTr/SYNTH_001.nii.gz (MSD convention)."""
    root = Path(root)
    msd = make_synthetic_msd(root / "msd")
    image = np.asarray(nib.load(msd / "imagesTr" / f"{SYNTH_NAME}.nii.gz").dataobj)
    files = {}
    for name, channel in SYNTH_STUDY_CHANNELS.items():
        files[name] = root / f"synth_{name}.nii.gz"
        nib.save(nib.Nifti1Image(image[..., channel], SYNTH_AFFINE), files[name])
    return files
```

- [ ] **Step 3: Write test helpers `backend/tests/agent/study_fakes.py`**

```python
"""A synthetic four-file upload and a fake SegResNet that returns its labels in BraTS convention."""
from pathlib import Path

import nibabel as nib
import numpy as np

from jarvis_neuro.synthetic import SYNTH_AFFINE, SYNTH_NAME, write_synthetic_study

MSD_TO_BRATS = {1: 2, 2: 1, 3: 4}


def synthetic_upload(tmp: Path) -> tuple[dict[str, Path], Path]:
    files = write_synthetic_study(tmp)
    return files, tmp / "msd" / "labelsTr" / f"{SYNTH_NAME}.nii.gz"


def brats_segmenter(labels_path: Path, calls: list | None = None):
    def segment(files, dest: Path) -> None:
        if calls is not None:
            calls.append(dict(files))
        lab = np.asarray(nib.load(labels_path).dataobj)
        out = np.zeros(lab.shape, np.uint8)
        for msd, brats in MSD_TO_BRATS.items():
            out[lab == msd] = brats
        nib.save(nib.Nifti1Image(out, SYNTH_AFFINE), dest)
    return segment


def open_uploads(files: dict[str, Path]) -> dict:
    return {name: (path.name, open(path, "rb")) for name, path in files.items()}
```

- [ ] **Step 4: Write the failing tests `backend/tests/agent/test_studies.py`**

```python
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
```

`ref.modalities` is `{"flair": 0, "t1w": 1, "t1gd": 2, "t2w": 3}` too (lower-cased `dataset.json` names), which is why the image arrays line up.

- [ ] **Step 5: Run to verify failure**

Run: `cd backend && uv run pytest tests/agent/test_studies.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'jarvis_neuro.agent.studies'`.

- [ ] **Step 6: Implement `backend/src/jarvis_neuro/agent/studies.py` (core half)**

```python
"""Uploaded four-sequence studies (flow spec §2): validate, segment with the SegResNet service, bake a viewer case."""
import os
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import BinaryIO

import nibabel as nib
import numpy as np

from ..io_msd import LoadedCase
from ..labels import remap

SEQUENCES = ("t1c", "t1", "t2", "flair")  # SegResNet's upload fields
# MSD channel order [FLAIR, T1, T1gd, T2], keyed by the modality names bake.py and cortex.py read.
MSD_CHANNELS = (("flair", "flair"), ("t1w", "t1"), ("t1gd", "t1c"), ("t2w", "t2"))
BRATS_TO_MSD = {1: 2, 2: 1, 4: 3}  # BraTS 1 NCR, 2 ED, 4 ET -> MSD 2 NCR, 1 ED, 3 ET
STEPS = ("read", "volume", "segment", "measure")
PROVENANCE = "monai-segresnet"
MAX_UPLOAD_MB = 250
DEFAULT_SEGRESNET_URL = "http://localhost:8001"


class UploadTooLarge(ValueError):
    pass


def segresnet_url() -> str:
    return os.environ.get("SEGRESNET_URL", DEFAULT_SEGRESNET_URL).rstrip("/")


def remap_brats_to_msd(seg: np.ndarray) -> np.ndarray:
    seg = np.rint(np.asarray(seg)).astype(np.int64)
    unexpected = set(np.unique(seg).tolist()) - {0, *BRATS_TO_MSD}
    if unexpected:
        raise ValueError(f"unexpected label {min(unexpected)} in seg.nii.gz")
    return remap(seg, BRATS_TO_MSD)


def save_uploads(dest: Path, uploads: Mapping[str, tuple[str, BinaryIO] | None]) -> dict[str, Path]:
    dest.mkdir(parents=True)
    files: dict[str, Path] = {}
    total = 0
    for name in SEQUENCES:
        upload = uploads.get(name)
        if upload is None or not upload[0]:
            raise ValueError(f"{name}: file is required")
        filename, stream = upload
        lower = filename.lower()
        ext = ".nii.gz" if lower.endswith(".nii.gz") else ".nii" if lower.endswith(".nii") else None
        if ext is None:
            raise ValueError(f"{name}: expected a .nii or .nii.gz file")
        files[name] = dest / f"{name}{ext}"
        with open(files[name], "wb") as out:
            shutil.copyfileobj(stream, out)
        total += files[name].stat().st_size
        if total > MAX_UPLOAD_MB * 1024 * 1024:
            raise UploadTooLarge(f"upload larger than {MAX_UPLOAD_MB} MB")
    return files


def read_sequences(files: Mapping[str, Path]) -> dict[str, nib.Nifti1Image]:
    """Headers only. Shape and affine must match t1c (atol 1e-3): SegResNet writes seg.nii.gz on that grid."""
    images = {}
    for name in SEQUENCES:
        try:
            img = nib.load(files[name])
        except Exception as e:
            raise ValueError(f"{name}: not a readable NIfTI") from e
        if len(img.shape) != 3:
            raise ValueError(f"{name}: expected a 3D volume, got shape {img.shape}")
        images[name] = img
    ref = images["t1c"]
    for name, img in images.items():
        if img.shape != ref.shape:
            raise ValueError(f"{name}: shape {img.shape} does not match t1c {ref.shape}")
        if not np.allclose(img.affine, ref.affine, atol=1e-3):
            raise ValueError(f"{name}: affine does not match t1c")
    return images


def to_case(case_id: str, images: Mapping[str, nib.Nifti1Image]) -> LoadedCase:
    canon = {name: nib.as_closest_canonical(img) for name, img in images.items()}
    image = np.stack([np.asarray(canon[src].dataobj, dtype=np.float32) for _, src in MSD_CHANNELS], axis=-1)
    modalities = {msd: i for i, (msd, _) in enumerate(MSD_CHANNELS)}
    return LoadedCase(case_id, image, modalities, None, canon["t1c"].affine.astype(np.float64))


def load_seg(path: Path, case: LoadedCase) -> np.ndarray:
    img = nib.as_closest_canonical(nib.load(path))
    if img.shape != case.image.shape[:3] or not np.allclose(img.affine, case.vox2ras, atol=1e-3):
        raise ValueError(f"seg.nii.gz grid {img.shape} does not match the study {case.image.shape[:3]}")
    return remap_brats_to_msd(np.asarray(img.dataobj))
```

- [ ] **Step 7: Run tests**

Run: `cd backend && uv run pytest tests/agent/test_studies.py -q`
Expected: 9 passed.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(studies): validate four-sequence uploads and remap BraTS labels" -- \
  backend/src/jarvis_neuro/synthetic.py backend/src/jarvis_neuro/agent/studies.py \
  backend/tests/agent/study_fakes.py backend/tests/agent/test_studies.py
```

(New files: `git add <those paths>` first, then the pathspec commit.)

### Task B2: SegResNet client and study runner

**Files:**
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (via `uv`)
- Modify: `backend/src/jarvis_neuro/agent/studies.py`
- Test: `backend/tests/agent/test_studies.py` (append)

**Interfaces:**
- Consumes: B1 functions.
- Produces: `Segmenter = Callable[[Mapping[str, Path], Path], None]`; `SegResNetClient(base_url, http=None, poll_s=2.0, timeout_s=1800.0, sleep=time.sleep)` callable as a `Segmenter`; `Study(study_id, workdir, files)` with `.view() -> dict`; `StudyRunner(segment, cases_root=cases_dir, work_root=None)` with `.submit(uploads) -> str`, `.get(study_id) -> dict | None`, `.run(study) -> None`.

- [ ] **Step 1: Move httpx to runtime deps, add python-multipart**

```bash
cd backend && uv add httpx python-multipart && uv remove --group dev httpx
```

Expected: `pyproject.toml` `dependencies` gains `httpx` and `python-multipart`; `[dependency-groups] dev` keeps only `pytest`.

- [ ] **Step 2: Append failing tests to `test_studies.py`**

```python
import json

import httpx

from jarvis_neuro.agent.studies import SegResNetClient, Study, StudyRunner
from jarvis_neuro.manifest import CaseIndex, Manifest
from study_fakes import brats_segmenter


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
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && uv run pytest tests/agent/test_studies.py -q`
Expected: FAIL — `ImportError: cannot import name 'SegResNetClient'`.

- [ ] **Step 4: Implement — add to `studies.py`**

Extend the imports at the top of the file to:

```python
import logging
import os
import queue
import secrets
import shutil
import tempfile
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, BinaryIO

import httpx
import nibabel as nib
import numpy as np

from ..bake import bake_case
from ..io_msd import LoadedCase
from ..labels import remap
from ..manifest import update_index
from ..stats import voxel_sizes
from .cases import cases_dir

log = logging.getLogger(__name__)
```

Append at the end of the file:

```python
Segmenter = Callable[[Mapping[str, Path], Path], None]


class SegResNetClient:
    """Runs one job on the SegResNet service (backend/segresnet_api) and saves its seg.nii.gz to `dest`."""

    def __init__(self, base_url: str, http: httpx.Client | None = None, poll_s: float = 2.0,
                 timeout_s: float = 1800.0, sleep: Callable[[float], None] = time.sleep):
        self.base_url = base_url.rstrip("/")
        self.http = http or httpx.Client(timeout=httpx.Timeout(60.0, read=300.0))
        self.poll_s, self.timeout_s, self.sleep = poll_s, timeout_s, sleep

    def __call__(self, files: Mapping[str, Path], dest: Path) -> None:
        try:
            self._run(files, dest)
        except httpx.TransportError as e:
            raise RuntimeError(f"segmentation service unreachable at {self.base_url}") from e

    def _run(self, files: Mapping[str, Path], dest: Path) -> None:
        handles = {name: open(files[name], "rb") for name in SEQUENCES}
        try:
            r = self.http.post(f"{self.base_url}/jobs", files={
                name: (files[name].name, fh, "application/octet-stream") for name, fh in handles.items()
            })
        finally:
            for fh in handles.values():
                fh.close()
        job_id = _ok(r).json()["job_id"]
        deadline = time.monotonic() + self.timeout_s
        while True:
            status = _ok(self.http.get(f"{self.base_url}/jobs/{job_id}")).json()
            if status["status"] == "done":
                break
            if status["status"] == "failed":
                raise RuntimeError(status.get("error") or "segmentation failed")
            if time.monotonic() > deadline:
                raise RuntimeError(f"segmentation timed out after {self.timeout_s:.0f} s")
            self.sleep(self.poll_s)
        dest.write_bytes(_ok(self.http.get(f"{self.base_url}/jobs/{job_id}/seg.nii.gz")).content)


def _ok(r: httpx.Response) -> httpx.Response:
    if r.is_error:
        raise RuntimeError(f"segmentation service returned HTTP {r.status_code}: {r.text[:200]}")
    return r


class Study:
    def __init__(self, study_id: str, workdir: Path, files: dict[str, Path]):
        self.study_id, self.workdir, self.files = study_id, workdir, files
        self.status = "queued"
        self.step = STEPS[0]
        self.steps: dict[str, dict[str, Any]] = {name: {"state": "pending"} for name in STEPS}
        self.case_id: str | None = None
        self.error: str | None = None

    def view(self) -> dict[str, Any]:
        return {
            "study_id": self.study_id, "status": self.status, "step": self.step,
            "steps": {name: dict(info) for name, info in self.steps.items()},
            "case_id": self.case_id, "error": self.error,
        }


class StudyRunner:
    """Study table plus one worker thread; studies run one at a time.
    shortcut: the table is in memory and lost on restart, upgrade to disk if the server runs more than one process."""

    def __init__(self, segment: Segmenter, cases_root: Callable[[], Path] = cases_dir, work_root: Path | None = None):
        self.segment = segment
        self.cases_root = cases_root
        self.work_root = work_root or Path(tempfile.gettempdir()) / "jarvis-neuro-studies"
        self._studies: dict[str, Study] = {}
        self._lock = threading.Lock()
        self._queue: queue.Queue[Study] = queue.Queue()
        self._worker: threading.Thread | None = None

    def submit(self, uploads: Mapping[str, tuple[str, BinaryIO] | None]) -> str:
        study_id = secrets.token_hex(6)
        workdir = self.work_root / study_id
        try:
            files = save_uploads(workdir, uploads)
            read_sequences(files)
        except BaseException:
            shutil.rmtree(workdir, ignore_errors=True)
            raise
        study = Study(study_id, workdir, files)
        with self._lock:
            self._studies[study_id] = study
            if self._worker is None:
                self._worker = threading.Thread(target=self._work, name="studies", daemon=True)
                self._worker.start()
        self._queue.put(study)
        return study_id

    def get(self, study_id: str) -> dict[str, Any] | None:
        with self._lock:
            study = self._studies.get(study_id)
            return study.view() if study else None

    def _work(self) -> None:
        while True:
            study = self._queue.get()
            try:
                self.run(study)
            finally:
                shutil.rmtree(study.workdir, ignore_errors=True)

    def run(self, study: Study) -> None:
        state: dict[str, Any] = {}
        for name, step in (("read", self._read), ("volume", self._volume),
                           ("segment", self._segment), ("measure", self._measure)):
            with self._lock:
                study.status, study.step = "running", name
                study.steps[name]["state"] = "running"
            try:
                info = step(study, state)
            except Exception as e:
                log.exception("study %s failed at %s", study.study_id, name)
                with self._lock:
                    study.steps[name]["state"] = "failed"
                    study.status = "failed"
                    study.error = (str(e).strip().splitlines() or [type(e).__name__])[0]
                return
            with self._lock:
                study.steps[name].update(info, state="done")
        with self._lock:
            study.status, study.case_id = "done", state["case_id"]

    def _read(self, study: Study, state: dict[str, Any]) -> dict[str, Any]:
        t0 = time.monotonic()
        state["images"] = read_sequences(study.files)
        return {"seconds": round(time.monotonic() - t0, 2)}

    def _volume(self, study: Study, state: dict[str, Any]) -> dict[str, Any]:
        case = state["case"] = to_case(f"study_{study.study_id}", state["images"])
        return {
            "dims": [int(n) for n in case.image.shape[:3]],
            "spacing_mm": [round(float(s), 3) for s in voxel_sizes(case.vox2ras)],
        }

    def _segment(self, study: Study, state: dict[str, Any]) -> dict[str, Any]:
        state["seg_path"] = study.workdir / "seg.nii.gz"
        self.segment(study.files, state["seg_path"])
        return {}

    def _measure(self, study: Study, state: dict[str, Any]) -> dict[str, Any]:
        case = state["case"]
        seg = load_seg(state["seg_path"], case)
        root = self.cases_root()
        manifest = bake_case(case, seg, PROVENANCE, root / case.case_id / PROVENANCE)
        update_index(root, manifest, f"{case.case_id}/{PROVENANCE}/manifest.json")
        state["case_id"] = case.case_id
        return {}
```

If `mask_u8.bin` counts differ from the reference because `bake_case` drops a label whose mesh has no faces, the test is wrong for that label, not the code: print both bincounts, then compare only labels present in the manifest's tumour assets.

- [ ] **Step 5: Run tests**

Run: `cd backend && uv run pytest tests/agent/test_studies.py -q`
Expected: 14 passed.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(studies): SegResNet client and one-worker study runner" -- \
  backend/pyproject.toml backend/uv.lock backend/src/jarvis_neuro/agent/studies.py backend/tests/agent/test_studies.py
```

### Task B3: Study routes

**Files:**
- Modify: `backend/src/jarvis_neuro/agent/app.py`
- Test: `backend/tests/agent/test_studies_api.py`

**Interfaces:**
- Consumes: `StudyRunner`, `SegResNetClient`, `UploadTooLarge`, `segresnet_url` from B1/B2.
- Produces: `create_app(..., studies: StudyRunner | None = None)`; `POST /api/studies` → `202 {"study_id"}`; `GET /api/studies/{id}` → spec §2 JSON.

- [ ] **Step 1: Impact check**

Run GitNexus `impact({target: "create_app", direction: "upstream"})`. Expected callers: `app` module global and `tests/agent/test_app.py::_client`. The new keyword has a default, so existing callers are unchanged. Report the risk level.

- [ ] **Step 2: Write the failing tests `backend/tests/agent/test_studies_api.py`**

```python
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
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && uv run pytest tests/agent/test_studies_api.py -q`
Expected: FAIL — `TypeError: create_app() got an unexpected keyword argument 'studies'`.

- [ ] **Step 4: Implement in `app.py`**

Imports: change the fastapi line and add the studies import.

```python
from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
```

```python
from .studies import SegResNetClient, StudyRunner, UploadTooLarge, segresnet_url
```

Signature and routes (add `studies` after `repo`; add the routes right after `health`):

```python
def create_app(
    *,
    settings_loader: Callable[[], AgentSettings] = load_settings,
    model_builder: ModelBuilder = build_model,
    repo: CaseRepo | None = None,
    studies: StudyRunner | None = None,
    static_dir: Path | None = DEFAULT_STATIC_DIR,
) -> FastAPI:
    app = FastAPI(title="Jarvis-Neuro agent")
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    cases = repo or CaseRepo()
    runner = studies or StudyRunner(SegResNetClient(segresnet_url()))
```

```python
    @app.post("/api/studies", status_code=202)
    def create_study(
        t1c: UploadFile | None = None,
        t1: UploadFile | None = None,
        t2: UploadFile | None = None,
        flair: UploadFile | None = None,
    ) -> dict[str, str]:
        given = {"t1c": t1c, "t1": t1, "t2": t2, "flair": flair}
        uploads = {name: (f.filename or "", f.file) if f else None for name, f in given.items()}
        try:
            return {"study_id": runner.submit(uploads)}
        except UploadTooLarge as e:
            raise HTTPException(413, str(e)) from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.get("/api/studies/{study_id}")
    def study_status(study_id: str) -> dict[str, Any]:
        view = runner.get(study_id)
        if view is None:
            raise HTTPException(404, "unknown study")
        return view
```

Also update the module docstring's first line to mention the study API:
`"""FastAPI app: the agent WebSocket at /ws, the study upload API, a health check, and the built viewer."""`

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && uv run pytest -q`
Expected: all pass (existing `test_app.py` untouched).

- [ ] **Step 6: Manual smoke against a running SegResNet (skip if Docker is down; QA covers it in Q2)**

```bash
cd backend && uv run uvicorn jarvis_neuro.agent.app:app --port 8000
curl -s localhost:8000/api/studies/000000000000   # {"detail":"unknown study"}
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(agent): study upload and status routes" -- \
  backend/src/jarvis_neuro/agent/app.py backend/tests/agent/test_studies_api.py
```

### Task B4: Dockerfile, compose, env, ignores

**Files:**
- Create: `backend/Dockerfile`, `compose.yaml`, `.dockerignore`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `docker compose up --build` → viewer + API on `http://localhost:8080`, SegResNet on `http://localhost:8001`.

Container layout pins `static_dir` (spec §7 open item): the backend lives at `/app/backend`, so `REPO_ROOT = parents[4]` of `/app/backend/src/jarvis_neuro/agent/cases.py` is `/app`, and `DEFAULT_STATIC_DIR` resolves to `/app/frontend/dist`. `uv sync` installs the project editable, so `__file__` stays under `/app/backend/src`.

- [ ] **Step 1: `backend/Dockerfile`**

```dockerfile
# Build context: repo root (see compose.yaml). Stage 1 builds the viewer; stage 2 runs the agent server,
# which serves it. Layout mirrors the repo so REPO_ROOT resolves to /app and static_dir to /app/frontend/dist.
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY shared/ /app/shared/
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/app/backend/.venv/bin:$PATH" \
    CASES_DIR=/app/frontend/dist/cases
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
RUN uv sync --frozen --no-dev
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN useradd --create-home appuser && chown -R appuser /app/frontend/dist/cases
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1
CMD ["uvicorn", "jarvis_neuro.agent.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: `.dockerignore` (repo root)**

```
.git
.gitnexus
.worktrees
.claude
**/node_modules
**/.venv
**/__pycache__
**/.pytest_cache
data
frontend/dist
frontend/public/draco
frontend/public/mediapipe
frontend/public/cases/study_*
backend/segresnet_api/weights
backend/segresnet_api/jobs
.env
```

- [ ] **Step 3: `compose.yaml` (repo root)**

```yaml
# Full stack: SegResNet (:8001) + agent server serving the built viewer (:8080).
# Dev: `docker compose up --build segresnet` and run vite + uvicorn natively.
services:
  segresnet:
    build: ./backend/segresnet_api
    ports:
      - "8001:8000"
    environment:
      ALLOWED_ORIGINS: http://localhost:5173
    volumes:
      - ./backend/segresnet_api/weights:/app/weights:ro
      - segresnet-jobs:/app/jobs
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 10s
      timeout: 5s
      start_period: 60s
      retries: 12

  app:
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "8080:8000"
    env_file:
      - path: .env
        required: false
    environment:
      SEGRESNET_URL: http://segresnet:8000
      AGENT_ALLOWED_ORIGINS: http://localhost:8080,http://127.0.0.1:8080
    volumes:
      - cases:/app/frontend/dist/cases
    depends_on:
      segresnet:
        condition: service_healthy

volumes:
  segresnet-jobs:
  cases:
```

The `cases` named volume is seeded from the image's `dist/cases` (sample cases) on first run. To reset it: `docker compose down -v`.

- [ ] **Step 4: `.env.example`**

```bash
# Copy to .env (gitignored). The viewer and study upload work without a model; the agent needs one.
MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=
# Optional overrides (anthropic defaults: claude-haiku-5-5 / claude-sonnet-5-5)
ORCHESTRATOR_MODEL=
REASONER_MODEL=
# MODEL_PROVIDER=gemini needs GEMINI_API_KEY, ORCHESTRATOR_MODEL and REASONER_MODEL.
GEMINI_API_KEY=
# Native dev only; compose sets this to http://segresnet:8000
SEGRESNET_URL=http://localhost:8001
```

- [ ] **Step 5: `.gitignore` — append**

```
.env
frontend/public/cases/study_*/
```

- [ ] **Step 6: Validate compose and build** (needs Docker Desktop running; if `docker info` fails, stop and tell the user to start Docker Desktop)

```bash
docker compose config -q && echo compose-ok
docker compose build
```

Expected: `compose-ok`; both images build.

- [ ] **Step 7: Run and probe**

```bash
docker compose up -d
curl -sf localhost:8001/health      # {"status":"ok"}
curl -sf localhost:8080/api/health  # {"ok":true,...}
curl -sf localhost:8080/cases/index.json | head -5
curl -sf -o /dev/null -w '%{http_code}\n' localhost:8080/   # 200
docker compose down
```

- [ ] **Step 8: Commit**

```bash
git add backend/Dockerfile compose.yaml .dockerignore .env.example
git commit -m "build: full-stack compose with SegResNet and the agent server" -- \
  backend/Dockerfile compose.yaml .dockerignore .env.example .gitignore
```

---

## Frontend pane

All frontend commands run in `frontend/`. Test gate after every task: `npm test && npm run typecheck`.

### Task F1: Design tokens and shared chrome

**Files:**
- Modify: `frontend/src/ui/theme.css`, `frontend/src/ui/layout.css`, `frontend/src/ui/Header.tsx`, `frontend/src/ui/Footer.tsx`

**Interfaces:**
- Produces: CSS custom properties keep their existing names (`--bg`, `--panel`, `--panel2`, `--border`, `--text`, `--muted`, `--accent`, `--danger`, `--stage`) so existing CSS keeps working; new ones added as needed. Header renders tabs (see F7 for stage wiring; here they are static).

The Figma file defines no variables (`get_variable_defs` on `43:3` returns `{}`), so tokens come from the frames' fills.

- [ ] **Step 1: Load the Figma guidance and read the four frames**

Invoke the `figma:figma-design-to-code` skill. Then `get_design_context` (fileKey `rHjTVYYISZzHWvWNeSKaVE`) on `43:3`, `44:99`, `43:767`, `43:1149`, plus components `44:39` (Format Card) and `45:30` (Tool Call). Save each screenshot for reference in F5–F8.

- [ ] **Step 2: Map Figma fills to tokens in `theme.css`**

Collect every distinct hex colour, font family, font size and corner radius from the four outputs. Write them into the `:root` block, replacing the values of the existing names (background → `--bg`, card fill → `--panel`, raised fill → `--panel2`, stroke → `--border`, primary text → `--text`, secondary text → `--muted`, brand/primary → `--accent`, error → `--danger`) and adding `--radius-sm`, `--radius-md`, `--radius-lg`, and any extra brand colour as `--accent2`. Fonts: if Figma uses a family other than IBM Plex, set `--font-sans` / `--font-mono` to it with the current stacks as fallbacks. Keep the light-mode block; derive its values only if Figma has a light variant, else leave it as is.

- [ ] **Step 3: Restyle Header and Footer**

Header: brand text and mark as in frame `43:3`; a tab row `Upload · MRI Workspace · Explore · Learning Mode · Help` where the last three are `<button className="tab" disabled title="Not in this build">`; keep the webcam chip and case `<select>`. Footer: keep the disclaimer and data credit text verbatim; restyle only.

- [ ] **Step 4: Gate and commit**

```bash
npm test && npm run typecheck
git commit -m "feat(ui): NeuroVision tokens and header/footer chrome" -- \
  src/ui/theme.css src/ui/layout.css src/ui/Header.tsx src/ui/Footer.tsx
```

### Task F2: MPR state — `slices` + `activeAxis`

**Files:**
- Modify: `frontend/src/state/store.ts`, `frontend/src/tools/shortcuts.ts`, `frontend/src/ui/MriPanel.tsx`
- Test: `frontend/src/state/store.test.ts`, `frontend/src/tools/shortcuts.test.ts`, `frontend/src/tools/execute.test.ts`

**Interfaces:**
- Produces: `ViewerState.slices: Record<Axis, number>`, `ViewerState.activeAxis: Axis`; `setSlice(axis, index)` (sets `slices[axis]` and `activeAxis`); `focusPoint(ras: Vec3): void` (marker + all three slices through it); `slicesThrough(frame, ras | null): Record<Axis, number>`; `MriPanel({ axis, large? })`. `slice` is removed.
- `tools/execute.ts` needs no change: it already calls `s.setSlice(axis, index)`.

- [ ] **Step 1: Impact check (QA runs this too in Q1)**

GitNexus `impact` upstream on `setSlice`, `initialViewFor`, `MriPanel`, `shortcutCall` (the function in `shortcuts.ts` that builds `inspect_mri_slice` args — use `context({name: "shortcuts"})` to find its exact name). Expected consumers: `MriPanel.tsx`, `execute.ts`, `shortcuts.ts`, and the three tests. Report anything else before editing.

- [ ] **Step 2: Update tests first**

`store.test.ts` — in "applies the default view when a case loads" replace the `slice` assertion:

```ts
    expect(s.slices).toEqual({ axial: 25, coronal: 38, sagittal: 19 })
    expect(s.activeAxis).toBe('axial')
```

Replace "select moves the marker and the slice to the tumour centroid":

```ts
  it('select moves the marker and all three slices to the tumour centroid', async () => {
    const store = await loadedStore()
    store.getState().setSlice('coronal', 3)
    store.getState().setMarker([0, 0, 0])
    store.getState().select('tumor_ncr')
    const s = store.getState()
    expect(s.selected).toBe('tumor_ncr')
    expect(s.marker).toEqual([-24, 18, 3])
    expect(s.slices).toEqual({ axial: 25, coronal: 38, sagittal: 19 })
    expect(s.activeAxis).toBe('coronal')
  })

  it('setSlice moves one axis and makes it active', async () => {
    const store = await loadedStore()
    store.getState().setSlice('sagittal', 7)
    expect(store.getState().slices).toEqual({ axial: 25, coronal: 38, sagittal: 7 })
    expect(store.getState().activeAxis).toBe('sagittal')
  })

  it('focusPoint moves the marker and all three slices', async () => {
    const store = await loadedStore()
    store.getState().focusPoint([0, 0, 0])
    expect(store.getState().marker).toEqual([0, 0, 0])
    expect(store.getState().slices).toEqual({ axial: 24, coronal: 32, sagittal: 28 })
  })
```

(Synthetic voxel (28, 32, 24) is RAS (0, 0, 0); canonical axis 0 is flipped, and 55 − 28 = 27 — if the sagittal value is 27 not 28, the test is wrong; assert what `sliceIndexThrough` returns for RAS 0 and note it.)

`shortcuts.test.ts` — "steps slices with the arrow keys": replace the last line with

```ts
    expect(store.getState().slices.axial).toBe(26)
    expect(store.getState().activeAxis).toBe('axial')
```

`execute.test.ts` — "rounds and clamps slice indices": replace the last line with

```ts
    expect(store.getState().slices.axial).toBe(11)
    expect(store.getState().activeAxis).toBe('axial')
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/state src/tools`
Expected: FAIL on `slices` undefined / `focusPoint` not a function.

- [ ] **Step 4: Implement in `store.ts`**

Imports: `import { AXES, type Axis, AXIS_DIM, sliceCount } from '../lib/volume'`.

State/actions: in `ViewerState` replace `slice: { axis: Axis; index: number }` with

```ts
  slices: Record<Axis, number>
  activeAxis: Axis
```

In `ViewerActions` add `focusPoint(ras: Vec3): void`.

Helper (after `sliceIndexThrough`):

```ts
export function slicesThrough(frame: CaseFrame, ras: Vec3 | null): Record<Axis, number> {
  const at = (axis: Axis) => (ras ? sliceIndexThrough(frame, axis, ras) : Math.floor(sliceCount(frame.dims, axis) / 2))
  return Object.fromEntries(AXES.map((axis) => [axis, at(axis)])) as Record<Axis, number>
}
```

`InitialView` pick list: replace `'slice'` with `'slices' | 'activeAxis'`. In `initialViewFor` delete `const axis` and the `slice:` block; add

```ts
    slices: slicesThrough(loaded.frame, marker),
    activeAxis: 'axial',
```

Initial store state: replace `slice: { axis: 'axial', index: 0 },` with

```ts
    slices: { axial: 0, coronal: 0, sagittal: 0 },
    activeAxis: 'axial',
```

Actions:

```ts
    setSlice: (axis, index) => set((s) => ({ slices: { ...s.slices, [axis]: index }, activeAxis: axis })),
    setMarker: (marker) => set({ marker }),

    focusPoint(ras) {
      const current = get().current
      if (current) set({ marker: ras, slices: slicesThrough(current.frame, ras) })
    },

    select(id) {
      const { current } = get()
      const tumor = current && id ? tumorAssets(current.manifest).find((t) => t.id === id) : undefined
      if (!current || !tumor) {
        set({ selected: id })
        return
      }
      const marker: Vec3 = [...tumor.centroid_ras]
      set({ selected: id, marker, slices: slicesThrough(current.frame, marker) })
    },
```

- [ ] **Step 5: `shortcuts.ts` arrow keys**

```ts
    case 'ArrowUp':
    case 'ArrowDown':
      return {
        name: 'inspect_mri_slice',
        args: { axis: s.activeAxis, index: s.slices[s.activeAxis] + (key === 'ArrowUp' ? 1 : -1) },
      }
```

- [ ] **Step 6: `MriPanel.tsx` takes an axis**

Replace the component head and the parts that read `slice`:

```tsx
export function MriPanel({ axis, large = false }: { axis: Axis; large?: boolean }) {
  const current = useViewer((s) => s.current)
  const index = useViewer((s) => s.slices[axis])
  const active = useViewer((s) => s.activeAxis === axis)
  const marker = useViewer((s) => s.marker)
  const visible = useViewer((s) => s.visible)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const image = useMemo(() => {
    if (!current) return null
    const outline = outlineColors(tumorAssets(current.manifest), visible)
    return renderSlice(current.flair, current.mask, axis, index, outline)
  }, [current, axis, index, visible])

  const canvasHeight = useMemo(() => {
    if (!current) return CANVAS_WIDTH
    const { width, height } = sliceShape(current.frame.dims, axis)
    const sp = pixelSpacing(current.frame, axis)
    return Math.round((CANVAS_WIDTH * height * sp.row) / (width * sp.col))
  }, [current, axis])
```

In the drawing effect use `axis` / `index` in place of `slice.axis` / `slice.index`, and the dependency list `[image, marker, current, axis, index, canvasHeight]`.

Empty state: `<section className="panel mri"><h2>{axis}</h2><p className="muted">No case loaded.</p></section>`.

Delete `pickAxis` and the `tabs` block. Click handler:

```tsx
  const onCanvasClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = ((e.clientX - rect.left) / rect.width) * image.width - 0.5
    const row = ((e.clientY - rect.top) / rect.height) * image.height - 0.5
    s.setSlice(axis, index)
    s.focusPoint(slicePointToRas(current.frame, axis, index, col, row))
  }
```

Section: `<section className={`panel mri${large ? ' large' : ''}${active ? ' active' : ''}`} aria-label={`${axis} MRI`}>` with header `<h2>{axis} · FLAIR</h2>`. Remaining `slice.axis` → `axis`, `slice.index` → `index`. Slider `onChange={(e) => s.setSlice(axis, Number(e.target.value))}`. Remove the unused `AXES` / `sliceIndexThrough` imports.

`App.tsx` still renders `<MriPanel />`; change it to `<MriPanel axis="axial" />` so the build passes until F7 replaces the layout.

- [ ] **Step 7: Gate and commit**

```bash
npm test && npm run typecheck
git commit -m "feat(viewer): three-axis MPR state with an active axis" -- \
  src/state/store.ts src/state/store.test.ts src/tools/shortcuts.ts src/tools/shortcuts.test.ts \
  src/tools/execute.test.ts src/ui/MriPanel.tsx src/App.tsx
```

### Task F3: Study client, filename matcher, stage + study store

**Files:**
- Create: `frontend/src/lib/studies.ts`, `frontend/src/lib/studies.test.ts`
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/store.test.ts`

**Interfaces:**
- Produces (`lib/studies.ts`): `SEQUENCES`, `type Sequence`, `StudySchema`, `type Study`, `postStudy(files, fetchFn) -> Promise<string>`, `getStudy(id, fetchFn) -> Promise<Study>`, `slotFor(filename) -> Sequence | null`, `assignFiles<T extends {name: string}>(files: T[]) -> Partial<Record<Sequence, T>>`.
- Produces (store): `type Stage = 'upload' | 'processing' | 'workspace' | 'explore3d'`; state `stage`, `studyId: string | null`, `study: Study | null`, `studyError: string | null`; actions `setStage(stage)`, `uploadStudy(files: Record<Sequence, File>): Promise<void>`, `pollStudy(): Promise<void>`, `cancelStudy()`, `openCase(caseId, provenance?) -> Promise<LoadCaseResult>`.
- `loadCase` success moves `stage` from `upload` to `workspace` (so Header select and agent `load_case` leave the Upload screen).

- [ ] **Step 1: Write failing tests `frontend/src/lib/studies.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { assignFiles, getStudy, postStudy, slotFor } from './studies'

const f = (name: string) => ({ name })

describe('filename matcher', () => {
  it.each([
    ['BraTS2021_00012_t1ce.nii.gz', 't1c'],
    ['sub-01_T1Gd.nii', 't1c'],
    ['case_t1_gd.nii.gz', 't1c'],
    ['case-t1post.nii.gz', 't1c'],
    ['BraTS-GLI-00012-000-t1c.nii.gz', 't1c'],
    ['BraTS2021_00012_t1.nii.gz', 't1'],
    ['BraTS-GLI-00012-000-t1n.nii.gz', 't1'],
    ['BraTS2021_00012_flair.nii.gz', 'flair'],
    ['BraTS-GLI-00012-000-t2f.nii.gz', 'flair'],
    ['BraTS2021_00012_t2.nii.gz', 't2'],
    ['BraTS-GLI-00012-000-t2w.nii.gz', 't2'],
    ['T2_FLAIR.nii.gz', 'flair'],
    ['notes.txt', null],
  ])('%s → %s', (name, slot) => {
    expect(slotFor(name)).toBe(slot)
  })

  it('uses the basename only', () => {
    expect(slotFor('/data/t1ce_scans/patient_flair.nii.gz')).toBe('flair')
  })

  it('assigns each slot once and leaves duplicates open', () => {
    const files = [f('a_t1ce.nii.gz'), f('a_t1.nii.gz'), f('a_t2.nii.gz'), f('b_t2.nii.gz'), f('readme.md')]
    expect(assignFiles(files)).toEqual({ t1c: files[0], t1: files[1] })
  })
})

const study = {
  study_id: 'a1b2c3d4e5f6',
  status: 'running',
  step: 'segment',
  steps: {
    read: { state: 'done', seconds: 0.4 },
    volume: { state: 'done', dims: [240, 240, 155], spacing_mm: [1, 1, 1] },
    segment: { state: 'running' },
    measure: { state: 'pending' },
  },
  case_id: null,
  error: null,
}

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

describe('study api', () => {
  it('posts the four files and returns the id', async () => {
    const seen: FormData[] = []
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init.body as FormData)
      return new Response(JSON.stringify({ study_id: 'a1b2c3d4e5f6' }), { status: 202 })
    }) as typeof fetch
    const file = (n: string) => new File(['x'], n)
    const id = await postStudy({ t1c: file('a.nii'), t1: file('b.nii'), t2: file('c.nii'), flair: file('d.nii') }, fetchFn)
    expect(id).toBe('a1b2c3d4e5f6')
    expect([...seen[0].keys()]).toEqual(['t1c', 't1', 't2', 'flair'])
  })

  it('surfaces the server detail on a 400', async () => {
    const fetchFn = reply(400, { detail: 't2: affine does not match t1c' }) as unknown as typeof fetch
    const file = new File(['x'], 'a.nii')
    await expect(postStudy({ t1c: file, t1: file, t2: file, flair: file }, fetchFn)).rejects.toThrow(
      't2: affine does not match t1c',
    )
  })

  it('parses a study status', async () => {
    expect(await getStudy('a1b2c3d4e5f6', reply(200, study) as unknown as typeof fetch)).toEqual(study)
  })

  it('rejects a malformed status', async () => {
    await expect(getStudy('x', reply(200, { status: 'weird' }) as unknown as typeof fetch)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/studies.test.ts`
Expected: FAIL — cannot resolve `./studies`.

- [ ] **Step 3: Implement `frontend/src/lib/studies.ts`**

```ts
import { z } from 'zod'

/** The agent server's study API (flow spec §2). */
export const SEQUENCES = ['t1c', 't1', 't2', 'flair'] as const
export type Sequence = (typeof SEQUENCES)[number]

const StepState = z.enum(['pending', 'running', 'done', 'failed'])
const Vec3 = z.tuple([z.number(), z.number(), z.number()])

export const StudySchema = z.object({
  study_id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  step: z.enum(['read', 'volume', 'segment', 'measure']),
  steps: z.object({
    read: z.object({ state: StepState, seconds: z.number().optional() }),
    volume: z.object({ state: StepState, dims: Vec3.optional(), spacing_mm: Vec3.optional() }),
    segment: z.object({ state: StepState }),
    measure: z.object({ state: StepState }),
  }),
  case_id: z.string().nullable(),
  error: z.string().nullable(),
})
export type Study = z.infer<typeof StudySchema>

const detailOf = (body: unknown, status: number) =>
  body && typeof body === 'object' && typeof (body as { detail?: unknown }).detail === 'string'
    ? (body as { detail: string }).detail
    : `HTTP ${status}`

export async function postStudy(files: Record<Sequence, File>, fetchFn: typeof fetch): Promise<string> {
  const body = new FormData()
  for (const s of SEQUENCES) body.append(s, files[s], files[s].name)
  const res = await fetchFn('/api/studies', { method: 'POST', body })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detailOf(data, res.status))
  return z.object({ study_id: z.string() }).parse(data).study_id
}

export async function getStudy(id: string, fetchFn: typeof fetch): Promise<Study> {
  const res = await fetchFn(`/api/studies/${encodeURIComponent(id)}`)
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detailOf(data, res.status))
  return StudySchema.parse(data)
}

// Checked in order so t1 never takes a contrast file and t2 never takes FLAIR. t2f is BraTS 2023 FLAIR.
const RULES: [Sequence, RegExp][] = [
  ['t1c', /t1(c|ce|gd|_gd|-gd|post)/],
  ['flair', /flair|t2f/],
  ['t2', /t2/],
  ['t1', /t1(?!c|ce|gd|_gd|-gd|post)/],
]

export function slotFor(filename: string): Sequence | null {
  const base = filename.split(/[\\/]/).pop()!.toLowerCase()
  return RULES.find(([, re]) => re.test(base))?.[0] ?? null
}

/** A slot is filled only when exactly one file matches it; the rest stay open for manual choice. */
export function assignFiles<T extends { name: string }>(files: T[]): Partial<Record<Sequence, T>> {
  const bySlot = new Map<Sequence, T[]>()
  for (const file of files) {
    const slot = slotFor(file.name)
    if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), file])
  }
  return Object.fromEntries([...bySlot].filter(([, fs]) => fs.length === 1).map(([s, fs]) => [s, fs[0]]))
}
```

The `t2f` rule extends spec §3's matcher for BraTS 2023 names (`t1n`, `t1c`, `t2w`, `t2f`); `t2` is checked after `flair`, so the spec's "and not flair" holds.

- [ ] **Step 4: Run matcher/API tests**

Run: `npm test -- src/lib/studies.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing store tests — append to `store.test.ts`**

```ts
const STUDY = {
  study_id: 'a1b2c3d4e5f6',
  status: 'done',
  step: 'measure',
  steps: {
    read: { state: 'done', seconds: 0.1 },
    volume: { state: 'done', dims: [56, 64, 48], spacing_mm: [3, 3, 3] },
    segment: { state: 'done' },
    measure: { state: 'done' },
  },
  case_id: 'synth_001',
  error: null,
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status })

describe('stages and studies', () => {
  it('starts on upload and moves to processing after a successful upload', async () => {
    const store = createViewerStore({ fetchFn: fsFetch({ '/api/studies': json(202, { study_id: 'a1b2c3d4e5f6' }) }) })
    expect(store.getState().stage).toBe('upload')
    const file = new File(['x'], 'a.nii')
    await store.getState().uploadStudy({ t1c: file, t1: file, t2: file, flair: file })
    expect(store.getState().stage).toBe('processing')
    expect(store.getState().studyId).toBe('a1b2c3d4e5f6')
    expect(store.getState().studyError).toBeNull()
  })

  it('stays on upload with the server reason when the upload is rejected', async () => {
    const store = createViewerStore({ fetchFn: fsFetch({ '/api/studies': json(400, { detail: 't1: shape (1, 2, 3) does not match t1c (4, 5, 6)' }) }) })
    const file = new File(['x'], 'a.nii')
    await store.getState().uploadStudy({ t1c: file, t1: file, t2: file, flair: file })
    expect(store.getState().stage).toBe('upload')
    expect(store.getState().studyError).toBe('t1: shape (1, 2, 3) does not match t1c (4, 5, 6)')
  })

  it('polls the study and ignores a cancelled one', async () => {
    const store = createViewerStore({
      fetchFn: fsFetch({
        '/api/studies': json(202, { study_id: 'a1b2c3d4e5f6' }),
        '/api/studies/a1b2c3d4e5f6': json(200, STUDY),
      }),
    })
    const file = new File(['x'], 'a.nii')
    await store.getState().uploadStudy({ t1c: file, t1: file, t2: file, flair: file })
    await store.getState().pollStudy()
    expect(store.getState().study?.status).toBe('done')
    store.getState().cancelStudy()
    expect(store.getState()).toMatchObject({ stage: 'upload', studyId: null, study: null })
  })

  it('openCase reloads the index and lands on the workspace', async () => {
    const store = createViewerStore({ fetchFn: fsFetch() })
    store.getState().setStage('processing')
    const r = await store.getState().openCase('synth_001')
    expect(r.ok).toBe(true)
    expect(store.getState().index?.cases.length).toBeGreaterThan(0)
    expect(store.getState().stage).toBe('workspace')
  })

  it('a case loaded from upload moves to the workspace', async () => {
    const store = await loadedStore()
    expect(store.getState().stage).toBe('workspace')
  })
})
```

Check `fsFetch` in `src/test/fixtures.ts` handles URLs outside `public/` via `overrides` (it reads `overrides[url]` first). If it passes `init` through and the `'/api/studies'` key is hit for both POST and GET of `/api/studies/<id>`, that is fine: the keys differ.

- [ ] **Step 6: Run to verify failure**

Run: `npm test -- src/state/store.test.ts`
Expected: FAIL — `stage` undefined.

- [ ] **Step 7: Implement in `store.ts`**

Imports: `import { type Sequence, type Study, getStudy, postStudy } from '../lib/studies'`.

Types:

```ts
export type Stage = 'upload' | 'processing' | 'workspace' | 'explore3d'
```

`ViewerState` add:

```ts
  stage: Stage
  studyId: string | null
  study: Study | null
  /** Upload rejection or lost contact with the study API, one line. */
  studyError: string | null
```

`ViewerActions` add:

```ts
  setStage(stage: Stage): void
  uploadStudy(files: Record<Sequence, File>): Promise<void>
  pollStudy(): Promise<void>
  cancelStudy(): void
  openCase(caseId: string, provenance?: Provenance): Promise<LoadCaseResult>
```

Inside `createViewerStore`, before `return createStore`: `const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis)`.

Initial state: `stage: 'upload', studyId: null, study: null, studyError: null,`.

In `loadCase`'s success `set((s) => ({ ... }))` add `stage: s.stage === 'upload' ? 'workspace' : s.stage,`.

Actions:

```ts
    setStage: (stage) => set({ stage }),

    async uploadStudy(files) {
      set({ studyError: null })
      try {
        const studyId = await postStudy(files, fetchFn)
        set({ stage: 'processing', studyId, study: null })
      } catch (e) {
        set({ studyError: messageOf(e) })
      }
    },

    async pollStudy() {
      const id = get().studyId
      if (!id) return
      try {
        const study = await getStudy(id, fetchFn)
        if (get().studyId === id) set({ study, studyError: null })
      } catch (e) {
        if (get().studyId === id) set({ studyError: `lost contact with the study: ${messageOf(e)}` })
      }
    },

    // The backend study keeps running; its result is ignored (flow spec §3).
    cancelStudy: () => set({ stage: 'upload', studyId: null, study: null, studyError: null }),

    async openCase(caseId, provenance) {
      await get().loadIndex()
      const r = await get().loadCase(caseId, provenance)
      if (r.ok) set({ stage: 'workspace' })
      return r
    },
```

- [ ] **Step 8: Gate and commit**

```bash
npm test && npm run typecheck
git add src/lib/studies.ts src/lib/studies.test.ts
git commit -m "feat(viewer): study API client, filename matcher and stage state" -- \
  src/lib/studies.ts src/lib/studies.test.ts src/state/store.ts src/state/store.test.ts
```

### Task F4: Upload screen (01)

**Files:**
- Create: `frontend/src/ui/UploadScreen.tsx`, `frontend/src/ui/UploadScreen.test.tsx`
- Modify: `frontend/src/ui/layout.css`

**Interfaces:**
- Consumes: `assignFiles`, `SEQUENCES`, `Sequence` (F3); store `uploadStudy`, `openCase`, `studyError`.
- Produces: `UploadScreen` (container) and `UploadView(props)` (pure, tested); `SLOT_LABEL: Record<Sequence, string>`; `isComplete(slots) -> slots is Record<Sequence, File>`.

- [ ] **Step 1: Failing test `UploadScreen.test.tsx`**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { UploadView, isComplete } from './UploadScreen'

const noop = () => {}
const file = (name: string) => new File(['x'], name)
const render = (slots: Parameters<typeof UploadView>[0]['slots'], error: string | null = null, busy = false) =>
  renderToStaticMarkup(
    <UploadView slots={slots} error={error} busy={busy} onFiles={noop} onSlot={noop} onSubmit={noop} onSample={noop} />,
  )

it('lists the four sequences and disables analyse until all are set', () => {
  const html = render({ t1c: file('a_t1ce.nii.gz') })
  for (const label of ['T1 contrast (T1c)', 'T1', 'T2', 'FLAIR']) expect(html).toContain(label)
  expect(html).toContain('a_t1ce.nii.gz')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Analyze scan<\/button>/)
})

it('shows unsupported formats as disabled', () => {
  const html = render({})
  for (const label of ['DICOM', 'ZIP', '2D slices']) expect(html).toContain(label)
  expect(html).toContain('not in this build')
})

it('shows the rejection reason inline', () => {
  expect(render({}, 't2: affine does not match t1c')).toContain('t2: affine does not match t1c')
})

it('isComplete needs all four', () => {
  const four = { t1c: file('a'), t1: file('b'), t2: file('c'), flair: file('d') }
  expect(isComplete(four)).toBe(true)
  expect(isComplete({ ...four, t2: undefined })).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/ui/UploadScreen.test.tsx`
Expected: FAIL — cannot resolve `./UploadScreen`.

- [ ] **Step 3: Implement `UploadScreen.tsx`**

```tsx
import { type DragEvent, useState } from 'react'
import { SEQUENCES, type Sequence, assignFiles } from '../lib/studies'
import { useViewer, viewerStore } from '../state/store'

export const SLOT_LABEL: Record<Sequence, string> = { t1c: 'T1 contrast (T1c)', t1: 'T1', t2: 'T2', flair: 'FLAIR' }
const DISABLED_FORMATS = ['DICOM', 'ZIP', '2D slices']
const SAMPLE_CASE = 'brats_001'

type Slots = Partial<Record<Sequence, File>>

export const isComplete = (slots: Slots): slots is Record<Sequence, File> => SEQUENCES.every((s) => slots[s])

export interface UploadViewProps {
  slots: Slots
  error: string | null
  busy: boolean
  onFiles(files: File[]): void
  onSlot(slot: Sequence, file: File | undefined): void
  onSubmit(): void
  onSample(): void
}

export function UploadView({ slots, error, busy, onFiles, onSlot, onSubmit, onSample }: UploadViewProps) {
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    onFiles([...e.dataTransfer.files])
  }
  return (
    <main className="upload-screen">
      <section className="panel drop-zone" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <h1>Upload MRI study</h1>
        <p className="muted">Drop the four NIfTI sequences (.nii / .nii.gz) or browse.</p>
        <label className="btn">
          Browse files
          <input
            type="file"
            multiple
            accept=".nii,.gz"
            hidden
            onChange={(e) => onFiles([...(e.target.files ?? [])])}
          />
        </label>
      </section>

      <section className="panel slots" aria-label="Sequences">
        {SEQUENCES.map((s) => (
          <label key={s} className="slot">
            <span className="lbl">{SLOT_LABEL[s]}</span>
            <span className="mono">{slots[s]?.name ?? 'Choose file…'}</span>
            <input type="file" accept=".nii,.gz" hidden onChange={(e) => onSlot(s, e.target.files?.[0])} />
          </label>
        ))}
      </section>

      <section className="formats" aria-label="Formats">
        <div className="panel format-card on">NIfTI · 4 sequences</div>
        {DISABLED_FORMATS.map((f) => (
          <div key={f} className="panel format-card" aria-disabled="true">
            {f} <span className="muted small">not in this build</span>
          </div>
        ))}
      </section>

      {error && <p className="error-line" role="alert">{error}</p>}

      <div className="upload-actions">
        <button className="btn primary" disabled={!isComplete(slots) || busy} onClick={onSubmit}>Analyze scan</button>
        <button className="btn" onClick={onSample}>Use sample</button>
      </div>

      <section className="panel privacy">
        <h2>Privacy</h2>
        <p className="muted">
          Volumes never leave this machine. The language model sees only the computed facts in manifest.json.
        </p>
      </section>
    </main>
  )
}

export function UploadScreen() {
  const error = useViewer((s) => s.studyError)
  const [slots, setSlots] = useState<Slots>({})
  const [busy, setBusy] = useState(false)
  const s = viewerStore.getState()
  return (
    <UploadView
      slots={slots}
      error={error}
      busy={busy}
      onFiles={(files) => setSlots((prev) => ({ ...prev, ...assignFiles(files) }))}
      onSlot={(slot, file) => setSlots((prev) => ({ ...prev, [slot]: file }))}
      onSubmit={async () => {
        if (!isComplete(slots)) return
        setBusy(true)
        await s.uploadStudy(slots)
        setBusy(false)
      }}
      onSample={() => void s.openCase(SAMPLE_CASE)}
    />
  )
}
```

Then match the layout and copy to frame `43:3` (headings, card order, Format Card component `44:39`) using the F1 screenshot; keep every element and label above, since the test asserts them. Add the needed classes to `layout.css` (`.upload-screen`, `.drop-zone`, `.slots`, `.slot`, `.formats`, `.format-card`, `.format-card[aria-disabled]` at 0.45 opacity, `.upload-actions`, `.privacy`, `.error-line` in `var(--danger)`).

- [ ] **Step 4: Gate and commit**

```bash
npm test && npm run typecheck
git add src/ui/UploadScreen.tsx src/ui/UploadScreen.test.tsx
git commit -m "feat(ui): upload screen with filename matching" -- \
  src/ui/UploadScreen.tsx src/ui/UploadScreen.test.tsx src/ui/layout.css
```

### Task F5: Processing screen (02)

**Files:**
- Create: `frontend/src/ui/ProcessingScreen.tsx`, `frontend/src/ui/ProcessingScreen.test.tsx`
- Modify: `frontend/src/ui/layout.css`

**Interfaces:**
- Consumes: `Study` (F3); store `study`, `studyId`, `studyError`, `pollStudy`, `cancelStudy`, `openCase`.
- Produces: `rowsFor(study: Study | null): Row[]` with `Row = { key; label; state: 'pending' | 'running' | 'done' | 'failed'; detail: string }`; `ProcessingScreen`.

- [ ] **Step 1: Failing test `ProcessingScreen.test.tsx`**

```tsx
import { expect, it } from 'vitest'
import type { Study } from '../lib/studies'
import { rowsFor } from './ProcessingScreen'

const base: Study = {
  study_id: 'a1b2c3d4e5f6',
  status: 'running',
  step: 'segment',
  steps: {
    read: { state: 'done', seconds: 0.4 },
    volume: { state: 'done', dims: [240, 240, 155], spacing_mm: [1, 1, 1] },
    segment: { state: 'running' },
    measure: { state: 'pending' },
  },
  case_id: null,
  error: null,
}

it('maps a running study to row states and details', () => {
  expect(rowsFor(base)).toEqual([
    { key: 'read', label: 'Read file', state: 'done', detail: '0.4 s' },
    { key: 'volume', label: 'Build 3D volume', state: 'done', detail: '240 × 240 × 155 · 1.00 × 1.00 × 1.00 mm' },
    { key: 'segment', label: 'Segment tumor', state: 'running', detail: 'SegResNet' },
    { key: 'measure', label: 'Measure volume & location', state: 'pending', detail: '' },
  ])
})

it('shows the error on the failed row', () => {
  const failed: Study = {
    ...base,
    status: 'failed',
    steps: { ...base.steps, segment: { state: 'failed' } },
    error: 'segmentation service unreachable at http://localhost:8001',
  }
  expect(rowsFor(failed)[2]).toEqual({
    key: 'segment',
    label: 'Segment tumor',
    state: 'failed',
    detail: 'segmentation service unreachable at http://localhost:8001',
  })
})

it('shows every row pending before the first poll', () => {
  expect(rowsFor(null).map((r) => r.state)).toEqual(['pending', 'pending', 'pending', 'pending'])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/ui/ProcessingScreen.test.tsx`
Expected: FAIL — cannot resolve `./ProcessingScreen`.

- [ ] **Step 3: Implement `ProcessingScreen.tsx`**

```tsx
import { useEffect } from 'react'
import type { Study } from '../lib/studies'
import { useViewer, viewerStore } from '../state/store'

type StepKey = keyof Study['steps']
type StepState = Study['steps'][StepKey]['state']
export interface Row {
  key: StepKey
  label: string
  state: StepState
  detail: string
}

const LABELS: Record<StepKey, string> = {
  read: 'Read file',
  volume: 'Build 3D volume',
  segment: 'Segment tumor',
  measure: 'Measure volume & location',
}
const POLL_MS = 1000

function detailFor(key: StepKey, study: Study): string {
  const s = study.steps
  if (s[key].state === 'failed') return study.error ?? ''
  if (key === 'read' && s.read.seconds !== undefined) return `${s.read.seconds} s`
  if (key === 'volume' && s.volume.dims && s.volume.spacing_mm)
    return `${s.volume.dims.join(' × ')} · ${s.volume.spacing_mm.map((v) => v.toFixed(2)).join(' × ')} mm`
  if (key === 'segment') return 'SegResNet'
  return ''
}

export function rowsFor(study: Study | null): Row[] {
  return (Object.keys(LABELS) as StepKey[]).map((key) => ({
    key,
    label: LABELS[key],
    state: study ? study.steps[key].state : 'pending',
    detail: study ? detailFor(key, study) : '',
  }))
}

export function ProcessingScreen() {
  const study = useViewer((s) => s.study)
  const studyId = useViewer((s) => s.studyId)
  const error = useViewer((s) => s.studyError)
  const finished = study?.status === 'done' || study?.status === 'failed'

  useEffect(() => {
    if (!studyId || finished) return
    const s = viewerStore.getState()
    void s.pollStudy()
    const timer = setInterval(() => void s.pollStudy(), POLL_MS)
    return () => clearInterval(timer)
  }, [studyId, finished])

  const s = viewerStore.getState()
  return (
    <main className="processing-screen">
      <section className="panel">
        <h1>Analyzing scan</h1>
        <p className="muted mono">Study {studyId}</p>
        <ol className="steps">
          {rowsFor(study).map((r) => (
            <li key={r.key} className={`step ${r.state}`}>
              <span className="step-label">{r.label}</span>
              <span className="muted small">{r.detail}</span>
              {r.key === 'segment' && r.state === 'running' && (
                <span className="bar indeterminate" role="progressbar" aria-label="Segmenting" />
              )}
            </li>
          ))}
        </ol>
        {error && <p className="error-line" role="alert">{error}</p>}
        <div className="upload-actions">
          <button className="btn" onClick={() => s.cancelStudy()}>Cancel</button>
          <button
            className="btn primary"
            disabled={study?.status !== 'done' || !study.case_id}
            onClick={() => study?.case_id && void s.openCase(study.case_id, 'monai-segresnet')}
          >
            Open MRI Workspace
          </button>
        </div>
      </section>
    </main>
  )
}
```

The indeterminate bar has no `aria-valuenow`: SegResNet reports no percentage (spec §2). Style to frame `44:99`; add `.processing-screen`, `.steps`, `.step.{pending,running,done,failed}`, `.bar.indeterminate` (CSS keyframe sliding stripe, `prefers-reduced-motion: reduce` → static) to `layout.css`.

- [ ] **Step 4: Gate and commit**

```bash
npm test && npm run typecheck
git add src/ui/ProcessingScreen.tsx src/ui/ProcessingScreen.test.tsx
git commit -m "feat(ui): processing screen polling the study" -- \
  src/ui/ProcessingScreen.tsx src/ui/ProcessingScreen.test.tsx src/ui/layout.css
```

### Task F6: Agent chips and atlas-only findings

**Files:**
- Modify: `frontend/src/ui/AgentConsole.tsx`, `frontend/src/ui/AgentConsole.test.tsx`, `frontend/src/ui/FindingsPanel.tsx`, `frontend/src/ui/format.ts`, `frontend/src/ui/format.test.ts`

**Interfaces:**
- Produces: `AGENT_CHIPS` in `AgentConsole.tsx`; `ATLAS_ONLY = 'Requires atlas — not in this build'` in `format.ts`; `Row` exported from `FindingsPanel.tsx`.

- [ ] **Step 1: Failing tests**

`AgentConsole.test.tsx` append:

```tsx
it('lists the live agents and greys the placeholders', () => {
  const html = render(agent())
  for (const name of ['Orchestrator', 'Clinical Reasoner', 'Vision', 'Spatial UI']) expect(html).toContain(name)
  expect(html.match(/class="chip placeholder"/g)).toHaveLength(2)
  expect(html).toContain('title="Placeholder — not in this build"')
})
```

`format.test.ts` append:

```ts
import { ATLAS_ONLY } from './format'

it('names the atlas-only text exactly', () => {
  expect(ATLAS_ONLY).toBe('Requires atlas — not in this build')
})
```

(Merge the import into the file's existing import line.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/ui`
Expected: FAIL on both.

- [ ] **Step 3: Implement**

`format.ts`:

```ts
/** Figma fields that need an atlas or a classifier (flow spec decision 2). */
export const ATLAS_ONLY = 'Requires atlas — not in this build'
```

`AgentConsole.tsx` — module constant and a chip row as the first child inside the `AgentConsoleView` root `<section>`:

```tsx
export const AGENT_CHIPS = [
  { name: 'Orchestrator', live: true },
  { name: 'Clinical Reasoner', live: true },
  { name: 'Vision', live: false },
  { name: 'Spatial UI', live: false },
] as const
```

```tsx
      <ul className="agent-chips" aria-label="Agents">
        {AGENT_CHIPS.map((a) => (
          <li
            key={a.name}
            className={a.live ? 'chip' : 'chip placeholder'}
            title={a.live ? undefined : 'Placeholder — not in this build'}
          >
            {a.name}
          </li>
        ))}
      </ul>
```

`FindingsPanel.tsx` — `export function Row`; rename the panel heading to `Volumetric Analysis`; when `tumors.length === 0` render `<p className="pad">No tumor detected</p>` in place of the sub-region list and the sum; after the Dice rows add:

```tsx
        <hr />
        <Row k="Lobe" v={ATLAS_ONLY} />
        <Row k="Tumor type" v={ATLAS_ONLY} />
        <Row k="Eloquent cortex" v={ATLAS_ONLY} />
```

`layout.css`: `.agent-chips` flex row; `.chip.placeholder { opacity: 0.45; }`.

- [ ] **Step 4: Gate and commit**

```bash
npm test && npm run typecheck
git commit -m "feat(ui): agent chips and atlas-only findings" -- \
  src/ui/AgentConsole.tsx src/ui/AgentConsole.test.tsx src/ui/FindingsPanel.tsx src/ui/format.ts \
  src/ui/format.test.ts src/ui/layout.css
```

### Task F7: Workspace screen (03) and stage switch

**Files:**
- Create: `frontend/src/ui/DatasetCard.tsx`, `frontend/src/ui/Workspace.tsx`, `frontend/src/ui/Explore3D.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/ui/Header.tsx`, `frontend/src/ui/layout.css`

**Interfaces:**
- Consumes: `MriPanel({axis, large})` (F2), stage actions (F3), screens (F4, F5), `Row` (F6).
- Produces: `App` renders by `stage`; boot leaves the viewer on Upload.

- [ ] **Step 1: `DatasetCard.tsx`**

```tsx
import { voxelSpacing } from '../lib/affine'
import { useViewer } from '../state/store'
import { Row } from './FindingsPanel'
import { PROVENANCE_LABEL } from './format'

export function DatasetCard() {
  const current = useViewer((s) => s.current)
  if (!current) return null
  const m = current.manifest
  return (
    <section className="panel" aria-label="Dataset">
      <div className="ph">
        <span>Dataset</span>
      </div>
      <div className="pad stack">
        <Row k="Case ID" v={m.case_id} />
        <Row k="Dimensions" v={m.dims.join(' × ')} />
        <Row k="Spacing" v={`${voxelSpacing(current.frame).map((v) => v.toFixed(2)).join(' × ')} mm`} />
        <Row k="Segmentation" v={PROVENANCE_LABEL[m.provenance]} />
      </div>
    </section>
  )
}
```

- [ ] **Step 2: `Workspace.tsx`**

```tsx
import { viewerStore } from '../state/store'
import { AgentConsole } from './AgentConsole'
import { DatasetCard } from './DatasetCard'
import { FindingsPanel } from './FindingsPanel'
import { MriPanel } from './MriPanel'

export function Workspace() {
  return (
    <main className="workspace-grid">
      <div className="left-col">
        <DatasetCard />
        <AgentConsole />
      </div>
      <div className="mpr-grid">
        <MriPanel axis="axial" large />
        <MriPanel axis="sagittal" />
        <MriPanel axis="coronal" />
      </div>
      <div className="right-col">
        <FindingsPanel />
        <button className="btn primary" onClick={() => viewerStore.getState().setStage('explore3d')}>
          Place tumor in 3D
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: `Explore3D.tsx`** (screen 04; F8 restyles)

```tsx
import { GestureCursor } from '../gestures/GestureCursor'
import { AgentConsole } from './AgentConsole'
import { FindingsPanel } from './FindingsPanel'
import { SceneControls } from './SceneControls'
import { ShortcutLegend } from './ShortcutLegend'
import { ViewportPanel } from './ViewportPanel'

export function Explore3D() {
  return (
    <main className="app-grid">
      <div className="left-col">
        <FindingsPanel />
        <SceneControls />
      </div>
      <div className="center-col">
        <ViewportPanel>
          <GestureCursor />
        </ViewportPanel>
      </div>
      <div className="right-col">
        <AgentConsole />
        <ShortcutLegend />
      </div>
    </main>
  )
}
```

- [ ] **Step 4: `App.tsx`**

```tsx
import { useHandTracking } from './gestures/useHandTracking'
import { type Stage, useViewer } from './state/store'
import { useShortcuts } from './tools/useShortcuts'
import { ErrorBanner } from './ui/ErrorBanner'
import { Explore3D } from './ui/Explore3D'
import { Footer } from './ui/Footer'
import { Header } from './ui/Header'
import { ProcessingScreen } from './ui/ProcessingScreen'
import { UploadScreen } from './ui/UploadScreen'
import { Workspace } from './ui/Workspace'
import './ui/layout.css'

const SCREENS: Record<Stage, () => React.JSX.Element> = {
  upload: UploadScreen,
  processing: ProcessingScreen,
  workspace: Workspace,
  explore3d: Explore3D,
}

export function App() {
  useShortcuts()
  useHandTracking()
  const Screen = SCREENS[useViewer((s) => s.stage)]
  return (
    <div className="app">
      <Header />
      <ErrorBanner />
      <Screen />
      <Footer />
    </div>
  )
}
```

If `React.JSX` is not in scope under the project's tsconfig, use `import type { JSX } from 'react'` and `() => JSX.Element`.

- [ ] **Step 5: `main.tsx` boot**

Replace `boot`:

```tsx
// Start on Upload (flow spec §3); the index feeds the header's case list and "Use sample".
void viewerStore.getState().loadIndex()
```

- [ ] **Step 6: Header tabs wired to `stage`**

```tsx
  const stage = useViewer((s) => s.stage)
  const setStage = viewerStore.getState().setStage
```

```tsx
      <nav className="tabs" aria-label="Sections">
        <button className={stage === 'upload' || stage === 'processing' ? 'tab active' : 'tab'} onClick={() => setStage('upload')}>
          Upload
        </button>
        <button
          className={stage === 'workspace' || stage === 'explore3d' ? 'tab active' : 'tab'}
          disabled={!current}
          onClick={() => setStage('workspace')}
        >
          MRI Workspace
        </button>
        {['Explore', 'Learning Mode', 'Help'].map((t) => (
          <button key={t} className="tab" disabled title="Not in this build">
            {t}
          </button>
        ))}
      </nav>
```

Clicking Upload while a study is processing returns to the Upload form; the study is not cancelled — keep it simple: `setStage('upload')` only when `stage !== 'processing'`, otherwise leave it (the Processing screen has its own Cancel). Implement that guard inline: `onClick={() => stage !== 'processing' && setStage('upload')}`.

- [ ] **Step 7: Layout CSS**

Add `.workspace-grid` (3 columns like `.app-grid`), `.mpr-grid` (`grid-template: "ax ax" 2fr "sag cor" 1fr / 1fr 1fr`; `.mri.large { grid-area: ax }`), `.mri.active` outline in `var(--accent)`. Match frame `43:767` with the F1 screenshot.

- [ ] **Step 8: Gate, manual check, commit**

```bash
npm test && npm run typecheck
npm run dev   # open http://localhost:5173: Upload shows; "Use sample" → Workspace with 3 MPR panels; "Place tumor in 3D" → scene
```

```bash
git add src/ui/DatasetCard.tsx src/ui/Workspace.tsx src/ui/Explore3D.tsx
git commit -m "feat(ui): stage-driven app with the MRI workspace" -- \
  src/ui/DatasetCard.tsx src/ui/Workspace.tsx src/ui/Explore3D.tsx src/App.tsx src/main.tsx \
  src/ui/Header.tsx src/ui/layout.css
```

### Task F8: 3D screen (04) fidelity pass

**Files:**
- Modify: `frontend/src/ui/Explore3D.tsx`, `frontend/src/ui/SceneControls.tsx`, `frontend/src/ui/layout.css`

**Interfaces:**
- Consumes: existing scene, `SceneControls`, webcam state.

- [ ] **Step 1: Compare with frame `43:1149`**

Run `npm run dev`, open the 3D screen, and compare against the F1 screenshot of `43:1149`. Left: pathology summary (`FindingsPanel`) then HUD toggles (`SceneControls`: opacity, focus tumor, hide healthy = brain surface visibility, explode, cutaway). Right: webcam telemetry (move the header's webcam chip detail — status and hand count from `s.webcam` — into a small panel here), agent console. Structures bar: one toggle per manifest tumour asset only (no anatomy chips — spec "Not built").

- [ ] **Step 2: Implement the layout changes only with existing actions**

Use `runUi('toggle_visibility', { asset_ids: ['brain_surface'], visible })` for "Hide healthy" and `runUi('focus_region', { asset_id })` for "Focus tumor" — both already exist in `ui/controls.ts`. No new store actions.

- [ ] **Step 3: Gate and commit**

```bash
npm test && npm run typecheck
git commit -m "feat(ui): 3D screen layout from the NeuroVision frame" -- \
  src/ui/Explore3D.tsx src/ui/SceneControls.tsx src/ui/layout.css
```

---

## QA pane

QA edits only `scripts/qa/`. Defects go to the owning pane as a message (file:line, command, output), not as a fix.

### Task Q1: Test gate and MPR impact baseline

**Files:**
- Create: `scripts/qa/check.sh`

- [ ] **Step 1: Impact baseline before F2**

GitNexus `impact` upstream on `setSlice`, `initialViewFor`, `select`, `MriPanel`; `context({name: "slice"})`. Post the list of consumers to the frontend pane. Any consumer outside `MriPanel.tsx`, `execute.ts`, `shortcuts.ts` and their tests is a finding.

- [ ] **Step 2: `scripts/qa/check.sh`**

```bash
#!/usr/bin/env bash
# Test gate: backend pytest, frontend vitest + tsc. Run from anywhere; exits non-zero on the first failure.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
(cd "$root/backend" && uv run pytest -q)
(cd "$root/frontend" && npm test --silent && npm run typecheck --silent)
if git -C "$root" diff --quiet -- frontend/public/cases/index.json; then :; else
  echo "WARN: frontend/public/cases/index.json is modified (study entries?) — do not commit it" >&2
fi
echo "check: all green"
```

`chmod +x scripts/qa/check.sh`; run it once now and record the baseline.

- [ ] **Step 3: Commit**

```bash
git add scripts/qa/check.sh
git commit -m "chore(qa): test gate script" -- scripts/qa/check.sh
```

- [ ] **Step 4: Watch loop**

After every backend/frontend commit (`git log --oneline -1` changes), run `scripts/qa/check.sh` and report red results to the owning pane.

### Task Q2: Compose end-to-end script (after B3; full run after B4)

**Files:**
- Create: `scripts/qa/e2e.sh`

- [ ] **Step 1: `scripts/qa/e2e.sh`**

```bash
#!/usr/bin/env bash
# End to end against a running stack: health -> upload four NIfTIs -> poll to done -> case in index -> manifest.
# Usage: scripts/qa/e2e.sh BASE_URL T1C T1 T2 FLAIR
#        scripts/qa/e2e.sh BASE_URL --synthetic        (tiny generated study; checks plumbing, not segmentation)
set -euo pipefail
base="${1:?base url, e.g. http://localhost:8080}"; shift
root="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "${1:-}" == "--synthetic" ]]; then
  tmp="$(mktemp -d)"
  (cd "$root/backend" && uv run python -c "
import sys; from pathlib import Path; from jarvis_neuro.synthetic import write_synthetic_study
f = write_synthetic_study(Path(sys.argv[1])); print(*(f[k] for k in ('t1c','t1','t2','flair')))" "$tmp") > "$tmp/paths"
  read -r t1c t1 t2 flair < "$tmp/paths"
else
  t1c="$1"; t1="$2"; t2="$3"; flair="$4"
fi

curl -sf "$base/api/health" >/dev/null && echo "health ok"
start=$(date +%s)
study=$(curl -sf -F "t1c=@$t1c" -F "t1=@$t1" -F "t2=@$t2" -F "flair=@$flair" "$base/api/studies" | jq -r .study_id)
echo "study $study"
while :; do
  body=$(curl -sf "$base/api/studies/$study")
  status=$(jq -r .status <<<"$body")
  printf '\r%-8s step=%-8s %4ss' "$status" "$(jq -r .step <<<"$body")" "$(( $(date +%s) - start ))"
  [[ "$status" == done || "$status" == failed ]] && break
  sleep 2
done
echo
jq . <<<"$body"
[[ "$status" == done ]] || { echo "FAIL: $(jq -r .error <<<"$body")"; exit 1; }
case_id=$(jq -r .case_id <<<"$body")
curl -sf "$base/cases/index.json" | jq -e --arg c "$case_id" '.cases[] | select(.case_id == $c)' >/dev/null && echo "index ok"
curl -sf "$base/cases/$case_id/monai-segresnet/manifest.json" | jq '{case_id, dims, assets: [.assets[] | {id, volume_ml}]}'
echo "e2e: PASS in $(( $(date +%s) - start ))s"
```

- [ ] **Step 2: Dev-mode run (after B3, Docker running)**

```bash
docker compose up -d --build segresnet
# backend pane's runner already serves :8000; vite serves cases on :5173
scripts/qa/e2e.sh http://localhost:5173 --synthetic
```

`--synthetic` checks plumbing only. Expected: `e2e: PASS` (SegResNet output on a synthetic ellipsoid may be "no tumor", which still bakes). Then delete the study case it created and restore the index so it is never committed: `rm -rf frontend/public/cases/study_* && git checkout -- frontend/public/cases/index.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/qa/e2e.sh
git commit -m "chore(qa): compose end-to-end script" -- scripts/qa/e2e.sh
```

### Task Q3: Full stack, screenshots, the user's MRI (after B4 and F8)

- [ ] **Step 1: Full stack**

```bash
docker compose up -d --build
scripts/qa/e2e.sh http://localhost:8080 --synthetic
docker stats --no-stream   # record segresnet peak memory while a study runs
```

- [ ] **Step 2: The user's MRI study**

When the user supplies four NIfTIs: `scripts/qa/e2e.sh http://localhost:8080 <t1c> <t1> <t2> <flair>`. Record wall time of the `segment` step and peak memory of the `segresnet` container (spec §7 open items). If dims or affines mismatch, report the 400 detail verbatim to the user.

- [ ] **Step 3: Browser walk-through and screenshots**

With Chrome tools on `http://localhost:8080`: Upload (drop the four files, check slot assignment) → Processing (rows advance; indeterminate bar while segmenting) → Open MRI Workspace (three MPR panels, dataset card, atlas-only rows) → Place tumor in 3D. Screenshot each screen next to the Figma frame (`43:3`, `44:99`, `43:767`, `43:1149`) and list visible gaps per screen to the frontend pane. Record a GIF of the flow (`neurovision_flow.gif`).

- [ ] **Step 4: Report**

Post to the user: e2e result, segment time, peak memory, screenshot gaps, and any red `check.sh` runs. Stop the stack: `docker compose down`.

---

## Runner tab

Separate herdr tab, three panes, long-running processes only:

| Pane | Command |
|---|---|
| frontend | `cd frontend && npm run dev` |
| backend | `cd backend && uv run uvicorn jarvis_neuro.agent.app:app --port 8000 --reload` |
| docker | `docker compose up --build segresnet` |

The backend runner needs B2's `uv add` before `/api/studies` works; `--reload` picks up code changes.
