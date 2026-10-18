import json

import numpy as np
import pytest
import trimesh

from jarvis_neuro.bake import bake_case, main
from jarvis_neuro.geometry import apply_affine
from jarvis_neuro.io_msd import load_msd_case
from jarvis_neuro.manifest import Manifest
from jarvis_neuro.synthetic import SYNTH_NAME, make_synthetic_msd

ALL = {"brain_surface", "tumor_et", "tumor_ncr", "tumor_ed"}


@pytest.fixture(scope="module")
def baked(tmp_path_factory):
    case = load_msd_case(make_synthetic_msd(tmp_path_factory.mktemp("msd")), SYNTH_NAME)
    out = tmp_path_factory.mktemp("cases") / case.case_id / "synthetic"
    return out, bake_case(case, case.labels, "synthetic", out), case


def tumors(m):
    return [a for a in m.assets if a.kind == "tumor"]


def test_writes_all_files_and_valid_manifest(baked):
    d, m, _ = baked
    for name in ("case.glb", "flair_u8.bin", "mask_u8.bin", "manifest.json"):
        assert (d / name).exists()
    assert Manifest.model_validate_json((d / "manifest.json").read_text()) == m
    assert {a.id for a in m.assets} == ALL


def test_glb_nodes_match_assets(baked):
    d, m, _ = baked
    scene = trimesh.load(d / "case.glb", force="scene")
    assert set(scene.graph.nodes_geometry) == {a.node for a in m.assets}


def test_bins_have_dims_and_mask_round_trips(baked):
    d, m, case = baked
    for name in ("flair_u8.bin", "mask_u8.bin"):
        assert (d / name).stat().st_size == int(np.prod(m.dims))
    raw = np.fromfile(d / "mask_u8.bin", np.uint8).reshape(m.dims)
    assert (raw == case.labels).all()


def test_flair_bin_is_brighter_in_edema_than_non_tumor_brain(baked):
    d, m, case = baked
    flair = np.fromfile(d / "flair_u8.bin", np.uint8).reshape(m.dims)
    edema = case.labels == 1
    non_tumor_brain = (case.image != 0).any(-1) & (case.labels == 0)
    assert flair[edema].mean() > flair[non_tumor_brain].mean()


def test_tumor_mesh_aligns_with_manifest_centroid(baked):
    """The alignment claim: GLB vertices and manifest numbers share one frame."""
    d, m, _ = baked
    scene = trimesh.load(d / "case.glb", force="scene")
    for a in tumors(m):
        geom = scene.geometry[scene.graph[a.node][1]]
        x, y, z = a.centroid_ras
        assert abs(y - z) > 5.0, "fixture must expose a y/z axis swap"
        expected = (-x, z, y)
        assert np.allclose(geom.vertices.mean(0), expected, atol=0.5, rtol=0), a.id


def test_tumor_centroids_inside_brain_and_left_of_midline(baked):
    _, m, case = baked
    A = np.array(m.vox2ras).reshape(4, 4)
    brain = (case.image != 0).any(-1)
    for a in tumors(m):
        ijk = np.rint(apply_affine(np.linalg.inv(A), np.array([a.centroid_ras]))[0]).astype(int)
        assert brain[tuple(ijk)], a.id
        assert a.centroid_ras[0] < m.midline_x_ras, a.id


def test_dice_against_identical_ground_truth_is_one(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path / "msd"), SYNTH_NAME)
    m = bake_case(case, case.labels, "synthetic", tmp_path / "out", gt=case.labels)
    assert m.metrics.dice_vs_gt == {"tumor_et": 1.0, "tumor_ncr": 1.0, "tumor_ed": 1.0}


def test_empty_label_is_omitted(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path / "msd"), SYNTH_NAME)
    seg = case.labels.copy()
    seg[seg == 3] = 2
    m = bake_case(case, seg, "synthetic", tmp_path / "out")
    assert "tumor_et" not in {a.id for a in m.assets}


def test_vanishing_label_is_omitted_from_assets_and_written_mask(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path / "msd"), SYNTH_NAME)
    seg = case.labels.copy()
    seg[seg == 3] = 2
    voxel = (27, 32, 24)
    seg[voxel] = 3  # A single voxel blurs below the 0.5 isosurface threshold.
    before = seg.copy()
    out = tmp_path / "out"
    m = bake_case(case, seg, "synthetic", out)
    assert "tumor_et" not in {a.id for a in m.assets}
    scene = trimesh.load(out / "case.glb", force="scene")
    assert "tumor_et" not in scene.graph.nodes_geometry
    written = np.fromfile(out / "mask_u8.bin", np.uint8).reshape(m.dims)
    expected = before.copy()
    expected[expected == 3] = 0
    np.testing.assert_array_equal(written, expected)
    np.testing.assert_array_equal(seg, before)


def test_cli_synthetic_writes_index(tmp_path):
    main(["synthetic", "--out", str(tmp_path)])
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx["cases"] == [{"case_id": "synth_001", "provenance": "synthetic",
                             "path": "synth_001/synthetic/manifest.json"}]
