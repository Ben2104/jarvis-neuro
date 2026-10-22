"""Uploaded four-sequence studies (flow spec §2): validate, segment with the SegResNet service, bake a viewer case."""
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
