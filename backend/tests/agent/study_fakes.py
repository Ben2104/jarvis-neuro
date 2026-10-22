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
