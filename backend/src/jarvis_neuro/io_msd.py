"""Load MSD Task01-layout cases, reoriented to RAS so slicing is plain array indexing."""
import json
from dataclasses import dataclass
from pathlib import Path

import nibabel as nib
import numpy as np

from .labels import label_map_from_dataset_json, remap


@dataclass(frozen=True)
class LoadedCase:
    case_id: str
    image: np.ndarray            # (I, J, K, C) float32, RAS-canonical
    modalities: dict[str, int]   # lower-cased dataset.json names → channel index
    labels: np.ndarray | None    # (I, J, K) uint8 in our convention
    vox2ras: np.ndarray          # (4, 4)


def read_dataset_json(root: Path) -> tuple[dict[str, int], dict[int, int]]:
    d = json.loads((Path(root) / "dataset.json").read_text())
    modalities = {name.lower(): int(k) for k, name in d["modality"].items()}
    return modalities, label_map_from_dataset_json(d["labels"])


def load_msd_case(root: Path, name: str) -> LoadedCase:
    root = Path(root)
    modalities, label_map = read_dataset_json(root)
    img = nib.as_closest_canonical(nib.load(root / "imagesTr" / f"{name}.nii.gz"))
    image = np.asarray(img.dataobj, dtype=np.float32)
    if image.ndim != 4 or image.shape[-1] != len(modalities):
        raise ValueError(f"MSD_SHAPE: {name} has shape {image.shape}, expected {len(modalities)} channels")
    labels = None
    label_path = root / "labelsTr" / f"{name}.nii.gz"
    if label_path.exists():
        lab = nib.as_closest_canonical(nib.load(label_path))
        if not np.allclose(lab.affine, img.affine, atol=1e-3):
            raise ValueError(f"MSD_AFFINE_MISMATCH: {name}")
        labels = remap(np.rint(np.asarray(lab.dataobj)), label_map)
    return LoadedCase(name.lower(), image, modalities, labels, img.affine.astype(np.float64))
