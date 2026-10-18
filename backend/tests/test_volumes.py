import numpy as np

from jarvis_neuro.volumes import window_to_u8, write_bin


def test_window_maps_percentiles_and_zeroes_background():
    vol = np.arange(1000, dtype=np.float32).reshape(10, 10, 10)
    brain = np.zeros_like(vol, bool); brain[1:9, 1:9, 1:9] = True
    u8 = window_to_u8(vol, brain)
    assert u8.dtype == np.uint8 and u8[0, 0, 0] == 0
    vals = vol[brain]
    lo, hi = np.percentile(vals, [1, 99])
    assert u8[brain][vals <= lo].max() == 0
    assert u8[brain][vals >= hi].min() == 255


def test_bin_is_c_order(tmp_path):
    a = np.random.default_rng(0).integers(0, 255, (3, 4, 5), dtype=np.uint8)
    write_bin(a, tmp_path / "x.bin")
    raw = np.fromfile(tmp_path / "x.bin", np.uint8)
    assert raw.size == 60
    i, j, k = 2, 1, 3
    assert raw[i * 4 * 5 + j * 5 + k] == a[i, j, k]
