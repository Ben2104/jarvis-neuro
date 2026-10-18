from pathlib import Path

import numpy as np


def window_to_u8(vol: np.ndarray, brain: np.ndarray, lo_pct: float = 1.0, hi_pct: float = 99.0) -> np.ndarray:
    lo, hi = np.percentile(vol[brain], [lo_pct, hi_pct])
    if hi <= lo:
        hi = lo + 1.0
    scaled = np.clip((vol - lo) / (hi - lo), 0.0, 1.0) * 255.0
    return np.rint(np.where(brain, scaled, 0.0)).astype(np.uint8)


def write_bin(arr: np.ndarray, path: Path) -> None:
    """Raw C-order bytes: index = i*J*K + j*K + k. The manifest's dims give the shape."""
    np.ascontiguousarray(arr, dtype=np.uint8).tofile(path)
