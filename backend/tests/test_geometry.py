import numpy as np
import trimesh

from jarvis_neuro.geometry import RAS2GL, apply_affine, mesh_from_mask, signed_volume

FLIPPED = np.array([[-2.0, 0, 0, 40], [0, 2, 0, -30], [0, 0, 2, -20], [0, 0, 0, 1]])   # det < 0 (LAS-like)
PLAIN = np.diag([2.0, 2.0, 2.0, 1.0])


def sphere_mask(shape, centre, r):
    g = np.indices(shape).transpose(1, 2, 3, 0)
    return ((g - np.asarray(centre)) ** 2).sum(-1) <= r * r


def test_ras_to_gl_axes():
    assert apply_affine(RAS2GL, np.array([[1.0, 2.0, 3.0]])).tolist() == [[-1.0, 3.0, 2.0]]
    assert np.isclose(np.linalg.det(RAS2GL[:3, :3]), 1.0)


def test_sphere_centroid_survives_flipped_affine():
    mask = sphere_mask((40, 40, 40), (18, 21, 20), 10)
    v, _ = mesh_from_mask(mask, FLIPPED, to_gl=False)
    expected = apply_affine(FLIPPED, np.array([[18.0, 21.0, 20.0]]))[0]
    assert np.allclose(v.mean(0), expected, atol=1.0)          # 0.5 voxel = 1 mm


def test_normals_point_outward_for_both_handedness():
    mask = sphere_mask((40, 40, 40), (20, 20, 20), 10)
    for affine in (PLAIN, FLIPPED):
        v, f = mesh_from_mask(mask, affine)
        assert signed_volume(v, f) > 0
        n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
        outward = v[f].mean(1) - v.mean(0)
        assert (np.einsum("ij,ij->i", n, outward) > 0).mean() > 0.99


def test_mesh_volume_matches_voxel_volume():
    mask = sphere_mask((40, 40, 40), (20, 20, 20), 10)
    v, f = mesh_from_mask(mask, FLIPPED)
    voxel_mm3 = mask.sum() * 8.0
    assert abs(signed_volume(v, f) - voxel_mm3) / voxel_mm3 < 0.05


def test_mask_touching_border_gives_closed_mesh():
    mask = np.zeros((10, 10, 10), bool)
    mask[:5] = True
    v, f = mesh_from_mask(mask, np.eye(4))
    assert trimesh.Trimesh(v, f, process=True).is_watertight


def test_empty_and_vanishing_masks_return_empty_mesh():
    v, f = mesh_from_mask(np.zeros((5, 5, 5), bool), np.eye(4))
    assert v.shape == (0, 3) and f.shape == (0, 3)
    one = np.zeros((9, 9, 9), bool)
    one[4, 4, 4] = True
    _, f = mesh_from_mask(one, np.eye(4), sigma=2.0)
    assert len(f) == 0
