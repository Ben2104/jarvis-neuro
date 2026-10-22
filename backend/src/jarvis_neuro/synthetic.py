"""A tiny MSD-layout case: ellipsoid brain, layered tumor in the LEFT hemisphere, LAS 3 mm affine.
Generated, not a scan of anyone. Exercises reorientation (det < 0), all three labels and non-cubic axes."""
import json
from pathlib import Path

import nibabel as nib
import numpy as np

SYNTH_NAME = "SYNTH_001"
SYNTH_SHAPE = (56, 64, 48)
# +i is LEFT (x decreases), so canonicalisation must flip axis 0. Voxel (28, 32, 24) sits at RAS (0, 0, 0).
SYNTH_AFFINE = np.array([[-3.0, 0, 0, 84], [0, 3, 0, -96], [0, 0, 3, -72], [0, 0, 0, 1]])
DATASET_JSON = {
    "name": "SYNTH",
    "modality": {"0": "FLAIR", "1": "T1w", "2": "t1gd", "3": "T2w"},
    "labels": {"0": "background", "1": "edema", "2": "non-enhancing tumor", "3": "enhancing tumour"},
}


def make_synthetic_msd(root: Path, seed: int = 0) -> Path:
    root = Path(root)
    (root / "imagesTr").mkdir(parents=True, exist_ok=True)
    (root / "labelsTr").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    g = np.indices(SYNTH_SHAPE).astype(np.float32).transpose(1, 2, 3, 0)
    centre = np.array([28.0, 32.0, 24.0])
    brain = (((g - centre) / [24.0, 28.0, 20.0]) ** 2).sum(-1) <= 1.0
    r = np.sqrt(((g - (centre + [8.0, 6.0, 1.0])) ** 2).sum(-1))
    labels = np.zeros(SYNTH_SHAPE, np.uint8)
    labels[(r <= 7.0) & brain] = 1      # edema
    labels[r <= 5.5] = 3                # enhancing ring
    labels[r <= 4.0] = 2                # necrotic core
    base = np.where(brain, 100.0 + rng.normal(0, 5, SYNTH_SHAPE), 0.0)
    flair = base + 100.0 * (labels == 1)
    t1 = base - 30.0 * (labels > 0)
    t1gd = base + 120.0 * (labels == 3)
    t2 = base + 80.0 * (labels > 0)
    image = (np.stack([flair, t1, t1gd, t2], -1) * brain[..., None]).astype(np.float32)
    nib.save(nib.Nifti1Image(image, SYNTH_AFFINE), root / "imagesTr" / f"{SYNTH_NAME}.nii.gz")
    nib.save(nib.Nifti1Image(labels, SYNTH_AFFINE), root / "labelsTr" / f"{SYNTH_NAME}.nii.gz")
    (root / "dataset.json").write_text(json.dumps(DATASET_JSON, indent=2))
    return root


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
