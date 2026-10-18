import numpy as np
import pytest

from jarvis_neuro.stats import (
    bbox_ras, centroid_ras, dice_score, midline_x_ras, min_dist_surface_mm, volume_ml,
)

A = np.array([[2.0, 0, 0, -10], [0, 3, 0, 5], [0, 0, 4, 0], [0, 0, 0, 1]])


def box(shape, lo, hi):
    m = np.zeros(shape, bool)
    m[tuple(slice(a, b) for a, b in zip(lo, hi))] = True
    return m


def test_volume_ml():
    m = box((10, 10, 10), (0, 0, 0), (5, 2, 1))       # 10 voxels × 24 mm³
    assert volume_ml(m, A) == pytest.approx(0.24)


def test_centroid_and_bbox_use_the_affine():
    m = box((10, 10, 10), (2, 4, 6), (5, 7, 9))       # indices 2..4, 4..6, 6..8
    assert centroid_ras(m, A).tolist() == pytest.approx([-4.0, 20.0, 28.0])
    lo, hi = bbox_ras(m, A)
    assert lo.tolist() == pytest.approx([-6.0, 17.0, 24.0])
    assert hi.tolist() == pytest.approx([-2.0, 23.0, 32.0])


def test_min_dist_surface_counts_the_volume_border_as_outside():
    brain = np.ones((20, 20, 20), bool)
    tumor = np.zeros_like(brain); tumor[3, 10, 10] = True
    assert min_dist_surface_mm(tumor, brain, np.diag([2.0, 2, 2, 1])) == pytest.approx(8.0)


def test_midline_is_bbox_centre_in_x():
    brain = box((20, 20, 20), (2, 0, 0), (18, 20, 20))  # x from 2*2-10=-6 to 2*17-10=24
    assert midline_x_ras(brain, A) == pytest.approx(9.0)


def test_dice():
    a = box((4, 4, 4), (0, 0, 0), (2, 4, 4))
    assert dice_score(a, a) == 1.0
    assert dice_score(a, ~a) == 0.0
    assert dice_score(np.zeros_like(a), np.zeros_like(a)) is None
