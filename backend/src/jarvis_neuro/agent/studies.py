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
