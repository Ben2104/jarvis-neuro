import numpy as np
import trimesh

from jarvis_neuro.cortex import cortex_mask, cortex_surface
from jarvis_neuro.geometry import mesh_from_mask
from jarvis_neuro.io_msd import LoadedCase


def folded_ball():
    x, y, z = np.indices((40, 40, 40)) - 20
    brain = x*x + y*y + z*z <= 16**2
    slabs = ((abs(x) < 2) & (y > 4)) | ((abs(y) < 2) & (z > 4)) | ((abs(z) < 2) & (x > 4))
    t1 = np.where(brain & ~slabs, 100.0, 0.0)
    return t1, brain, slabs


def test_sulci_open_and_increase_surface_area():
    t1, brain, slabs = folded_ball()
    mask = cortex_mask(t1, brain, np.zeros_like(brain))
    assert mask is not None
    x, y, z = np.indices(brain.shape) - 20
    near_surface = brain & (x*x + y*y + z*z > 14**2)
    assert not mask[slabs & near_surface].any()
    folded = trimesh.Trimesh(*mesh_from_mask(mask, np.eye(4), sigma=0.6), process=False)
    ball = trimesh.Trimesh(*mesh_from_mask(brain, np.eye(4), sigma=0.6), process=False)
    assert folded.area / ball.area > 1.05


def test_dark_tumour_is_included():
    t1, brain, _ = folded_ball()
    x, y, z = np.indices(brain.shape) - np.array([20, 29, 20])[:, None, None, None]
    tumour = x*x + y*y + z*z < 3**2
    t1[tumour] = 0
    assert cortex_mask(t1, brain, tumour)[tumour].all()


def test_constant_t1_returns_none():
    _, brain, _ = folded_ball()
    assert cortex_mask(np.ones(brain.shape), brain, np.zeros_like(brain)) is None


def test_missing_t1_returns_none():
    _, brain, _ = folded_ball()
    case = LoadedCase('test', brain[..., None], {'flair': 0}, None, np.eye(4))
    assert cortex_surface(case, brain, np.zeros_like(brain)) is None


def test_largest_component_drops_detached_island():
    t1, brain, _ = folded_ball()
    brain[1:4, 1:4, 1:4] = True
    t1[1:4, 1:4, 1:4] = 100
    mask = cortex_mask(t1, brain, np.zeros_like(brain))
    assert mask is not None
    assert not mask[1:4, 1:4, 1:4].any()
