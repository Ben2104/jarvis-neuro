import numpy as np
import trimesh

from jarvis_neuro.geometry import mesh_from_mask, signed_volume
from jarvis_neuro.glb import write_glb
from jarvis_neuro.meshing import smooth_and_decimate


def sphere(r=12, n=40):
    g = np.indices((n, n, n)).transpose(1, 2, 3, 0)
    return ((g - n / 2) ** 2).sum(-1) <= r * r


def test_decimate_hits_target_and_keeps_volume():
    v, f = mesh_from_mask(sphere(), np.eye(4))
    before = signed_volume(v, f)
    v2, f2 = smooth_and_decimate(v, f, target_faces=2000)
    assert len(f2) <= 2000 * 1.05
    assert abs(signed_volume(v2, f2) - before) / before < 0.05
    assert v2.dtype == np.float32 and f2.dtype == np.uint32


def test_empty_mesh_passes_through():
    v = np.zeros((0, 3), np.float32); f = np.zeros((0, 3), np.uint32)
    v2, f2 = smooth_and_decimate(v, f, target_faces=10)
    assert len(f2) == 0


def test_glb_round_trip_keeps_node_names_and_bounds(tmp_path):
    v, f = mesh_from_mask(sphere(), np.eye(4))
    write_glb([("brain_surface", v, f), ("tumor_et", v * 0.5, f)], tmp_path / "case.glb")
    scene = trimesh.load(tmp_path / "case.glb", force="scene")
    assert {"brain_surface", "tumor_et"} <= set(scene.graph.nodes_geometry)
    geom = scene.geometry[scene.graph["brain_surface"][1]]
    assert np.allclose(geom.bounds, [v.min(0), v.max(0)], atol=1e-4)
