"""Backend validation of scene tool arguments (spec §5). Mirrors the viewer's zod schemas.

Unknown asset ids raise ValueError, which Strands returns to the Orchestrator as an error tool result.
Finite numeric ranges are clamped; non-finite inputs are rejected.
"""
import math

import numpy as np

from ..manifest import Manifest

# Canonical RAS volumes: voxel axis i/j/k runs along RAS x/y/z.
AXIS_DIM = {"sagittal": 0, "coronal": 1, "axial": 2}


def clamp(value: float, lo: float, hi: float) -> float:
    if not math.isfinite(value):
        raise ValueError("value must be finite")
    return min(hi, max(lo, value))


def check_asset_ids(m: Manifest, ids: list[str]) -> list[str]:
    if not ids:
        raise ValueError("asset_ids must not be empty")
    known = [a.id for a in m.assets]
    for i in ids:
        if i not in known:
            raise ValueError(f"unknown asset_id {i!r}; expected one of {', '.join(known)}")
    return ids


def ras_extent(m: Manifest) -> tuple[list[float], list[float]]:
    """RAS min and max over the voxel-centre corners, like the viewer's rasExtent."""
    a = np.asarray(m.vox2ras, dtype=float).reshape(4, 4)
    di, dj, dk = (d - 1 for d in m.dims)
    corners = np.array([[i, j, k, 1.0] for i in (0, di) for j in (0, dj) for k in (0, dk)])
    ras = (corners @ a.T)[:, :3]
    return ras.min(axis=0).tolist(), ras.max(axis=0).tolist()


def clamp_cut_mm(m: Manifest, plane: str, ras_mm: float) -> float:
    if not math.isfinite(ras_mm):
        raise ValueError("ras_mm must be finite")
    lo, hi = ras_extent(m)
    d = AXIS_DIM[plane]
    return clamp(ras_mm, lo[d], hi[d])


def clamp_slice_index(m: Manifest, axis: str, index: float) -> int:
    """Round half up (JavaScript Math.round), then clamp to the slice count."""
    if not math.isfinite(index):
        raise ValueError("index must be finite")
    count = m.dims[AXIS_DIM[axis]]
    return int(clamp(math.floor(index + 0.5), 0, count - 1))
