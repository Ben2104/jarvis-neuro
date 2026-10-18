"""Measurements from voxels (never from meshes). Positions are voxel centres in RAS millimetres."""
from itertools import product

import numpy as np
from scipy.ndimage import distance_transform_edt

from .geometry import apply_affine


def voxel_sizes(vox2ras: np.ndarray) -> np.ndarray:
    return np.linalg.norm(vox2ras[:3, :3], axis=0)


def volume_ml(mask: np.ndarray, vox2ras: np.ndarray) -> float:
    return float(mask.sum() * abs(np.linalg.det(vox2ras[:3, :3])) / 1000.0)


def centroid_ras(mask: np.ndarray, vox2ras: np.ndarray) -> np.ndarray:
    return apply_affine(vox2ras, np.argwhere(mask).mean(0)[None])[0]


def bbox_ras(mask: np.ndarray, vox2ras: np.ndarray):
    idx = np.argwhere(mask)
    corners = np.array(list(product(*zip(idx.min(0), idx.max(0)))), float)
    ras = apply_affine(vox2ras, corners)
    return ras.min(0), ras.max(0)


def min_dist_surface_mm(tumor: np.ndarray, brain: np.ndarray, vox2ras: np.ndarray) -> float:
    """Distance from the nearest tumor voxel centre to the first voxel outside the brain."""
    d = distance_transform_edt(np.pad(brain, 1), sampling=voxel_sizes(vox2ras))[1:-1, 1:-1, 1:-1]
    return float(d[tumor].min())


def midline_x_ras(brain: np.ndarray, vox2ras: np.ndarray) -> float:
    lo, hi = bbox_ras(brain, vox2ras)
    return float((lo[0] + hi[0]) / 2)


def dice_score(a: np.ndarray, b: np.ndarray) -> float | None:
    s = int(a.sum()) + int(b.sum())
    return None if s == 0 else 2.0 * int((a & b).sum()) / s
