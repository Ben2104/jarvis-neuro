"""T1 tissue boundary for a fold-following cortex, with an envelope fallback."""
import numpy as np
from scipy.ndimage import binary_dilation, binary_erosion, binary_fill_holes, label
from skimage.filters import threshold_otsu

from .geometry import mesh_from_mask
from .io_msd import LoadedCase
from .meshing import smooth_and_decimate

BRAIN_TARGET_FACES = 100_000


def cortex_mask(t1: np.ndarray, brain: np.ndarray, tumour: np.ndarray) -> np.ndarray | None:
    values = t1[brain]
    if not values.size:
        return None
    lo, hi = np.percentile(values, [2, 98])
    if hi <= lo:
        return None
    t1n = np.clip((t1 - lo) / (hi - lo), 0, 1)
    interior = binary_erosion(brain, iterations=2)
    if not interior.any() or np.ptp(t1n[interior]) == 0:
        return None
    tissue = brain & (t1n > threshold_otsu(t1n[interior]))
    tissue |= binary_dilation(tumour, iterations=1)
    components, count = label(tissue, structure=np.ones((3, 3, 3)))
    if not count:
        return None
    sizes = np.bincount(components.ravel())
    sizes[0] = 0
    mask = binary_fill_holes(components == sizes.argmax())
    return mask if mask.sum() >= 0.5 * brain.sum() else None


def cortex_surface(case: LoadedCase, brain: np.ndarray, seg: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    if 't1w' not in case.modalities:
        return None
    mask = cortex_mask(case.image[..., case.modalities['t1w']], brain, seg > 0)
    if mask is None:
        return None
    return smooth_and_decimate(*mesh_from_mask(mask, case.vox2ras, sigma=0.6), BRAIN_TARGET_FACES, iterations=10)
