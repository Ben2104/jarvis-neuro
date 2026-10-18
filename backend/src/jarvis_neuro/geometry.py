"""Voxel masks → triangle meshes in glTF millimetres. The only place affines meet vertices."""
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.measure import marching_cubes

# RAS (+x right, +y anterior, +z superior) → glTF (+x asset-left, +y up, +z forward). det = +1.
RAS2GL = np.array([[-1.0, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]])

_EMPTY = (np.zeros((0, 3), np.float32), np.zeros((0, 3), np.uint32))


def apply_affine(m: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return pts @ m[:3, :3].T + m[:3, 3]


def signed_volume(verts: np.ndarray, faces: np.ndarray) -> float:
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def mesh_from_mask(mask: np.ndarray, vox2ras: np.ndarray, sigma: float = 0.0, to_gl: bool = True):
    if not mask.any():
        return _EMPTY
    vol = np.pad(mask.astype(np.float32), 1)          # closes meshes that touch the volume border
    if sigma > 0:
        vol = gaussian_filter(vol, sigma)
    if vol.max() <= 0.5:
        return _EMPTY
    # Voxel index space on purpose: the affine carries spacing, so passing spacing= would scale twice.
    verts, faces, _, _ = marching_cubes(vol, level=0.5, allow_degenerate=False)
    verts -= 1.0                                       # undo the padding
    m = RAS2GL @ vox2ras if to_gl else vox2ras
    verts = apply_affine(m, verts).astype(np.float32)
    faces = faces.astype(np.uint32)
    # One rule covers both skimage's winding and det(affine) < 0: closed outward meshes have positive volume.
    if signed_volume(verts, faces) < 0:
        faces = faces[:, ::-1].copy()
    return verts, faces
