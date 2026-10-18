# Bake Pipeline Implementation Plan (Plan A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline Python pipeline. It turns MSD brain-tumor MRI volumes into an aligned brain-surface and tumor GLB,
uint8 FLAIR and mask volumes, and a validated `manifest.json`. It also commits a small synthetic case so Plans B (viewer)
and C (agents) can start before the real dataset is downloaded.

**Architecture:** One Python package, `jarvis_neuro`, in `backend/`, made of small pure modules: labels, geometry,
meshing/GLB, stats, volumes, manifest, loader, synthetic fixture. `bake.py` composes them, and a CLI runs it. Every
number in the manifest is computed from voxels. Every mesh vertex is `ras2gl · vox2ras · ijk` in millimetres, so the
brain and tumor are aligned by construction. MONAI segmentation is an optional extra behind the same `bake_case` call.

**Tech Stack:** Python 3.12, uv, numpy, scipy, scikit-image, nibabel, trimesh, fast-simplification, pydantic v2, pytest.
The optional extra adds MONAI and torch. Draco compression is optional and uses `npx @gltf-transform/cli`.

Spec: `docs/superpowers/specs/2026-10-17-jarvis-neuro-design.md`

## Global Constraints

- Output label convention (MSD): `1` edema (ED), `2` non-enhancing/necrotic core (NCR), `3` enhancing (ET).
- Asset IDs: `brain_surface`, `tumor_et`, `tumor_ncr`, `tumor_ed`. GLB node names equal asset IDs.
- `ras2gl = [-1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1]` (row-major). Matrices in the manifest are row-major 16-number lists.
- Run marching cubes in voxel index space. Never pass `spacing=` to it.
- Stats come from voxels, never from meshes.
- Volumes are written C-order `[i][j][k]` as raw uint8. Size = `I*J*K` bytes.
- Provenance is one of `ground-truth`, `monai-segresnet`, `synthetic`. `synthetic` is added beyond the spec so the
  fixture is never labelled as real ground truth.
- The brain mask is hole-filled "any modality ≠ 0", unioned with the tumor. This refines the spec's `T1 > 0` so tumor
  voxels can never fall outside the brain.
- A tumor asset whose mask is empty, or whose mesh vanishes after smoothing, is omitted from both the manifest and the GLB.
- Bake output layout: `frontend/public/cases/<case_id>/<provenance>/{case.glb, flair_u8.bin, mask_u8.bin, manifest.json}`
  plus `frontend/public/cases/index.json`.
- Brain surface is decimated to about 100k triangles, each tumor sub-region to about 20k.
- No diagnostic wording anywhere in output files.

## File Structure

```
jarvis-neuro/
  .gitignore
  backend/
    .python-version                 3.12
    pyproject.toml
    src/jarvis_neuro/
      __init__.py
      labels.py         label constants, dataset.json name mapping, channel → exclusive labels
      geometry.py       RAS2GL, apply_affine, signed_volume, mesh_from_mask
      meshing.py        smooth_and_decimate
      glb.py            write_glb, draco_compress
      stats.py          volume, centroid, bbox, surface distance, midline, Dice
      volumes.py        window_to_u8, write_bin
      manifest.py       pydantic contract, JSON Schema export, index.json upsert
      io_msd.py         LoadedCase, MSD loader (canonical RAS)
      synthetic.py      tiny MSD-layout synthetic case
      segment_monai.py  optional MONAI bundle wrapper
      bake.py           bake_case + CLI (synthetic | msd | survey)
    tests/
      test_labels.py test_geometry.py test_meshing.py test_stats.py test_volumes.py
      test_manifest.py test_io.py test_bake.py test_segment_monai.py
  shared/manifest.schema.json        generated from manifest.py
  frontend/public/cases/             baked outputs (committed)
  scripts/fetch_msd.sh
  data/                              gitignored: dataset + MONAI bundle
```

---

### Task 1: Package scaffold and label conventions

**Files:**
- Create: `.gitignore`, `backend/.python-version`, `backend/pyproject.toml`, `backend/src/jarvis_neuro/__init__.py`
- Create: `backend/src/jarvis_neuro/labels.py`
- Test: `backend/tests/test_labels.py`

**Interfaces:**
- Produces:
  - `ED=1, NCR=2, ET=3`, `TUMOR_LABELS=(ET, NCR, ED)`
  - `ASSET_BY_LABEL: dict[int,str]`, `LABEL_BY_ASSET: dict[str,int]`, `COLOR_BY_LABEL: dict[int,str]`
  - `label_map_from_dataset_json(labels: dict[str,str]) -> dict[int,int]`
  - `remap(seg: np.ndarray, mapping: dict[int,int]) -> np.ndarray[uint8]`
  - `exclusive_from_channels(tc, wt, et: np.ndarray[bool]) -> np.ndarray[uint8]`

- [ ] **Step 1: Write scaffold files**

`.gitignore`:
```
data/
.venv/
__pycache__/
*.pyc
.pytest_cache/
node_modules/
```

`backend/.python-version`:
```
3.12
```

`backend/pyproject.toml`:
```toml
[project]
name = "jarvis-neuro"
version = "0.1.0"
requires-python = ">=3.11,<3.14"
dependencies = [
  "numpy>=2.0",
  "scipy>=1.13",
  "scikit-image>=0.24",
  "nibabel>=5.2",
  "trimesh>=4.4",
  "fast-simplification>=0.1.7",
  "pydantic>=2.7",
]

[project.optional-dependencies]
monai = ["monai>=1.4", "torch>=2.4"]

[dependency-groups]
dev = ["pytest>=8"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/jarvis_neuro"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`backend/src/jarvis_neuro/__init__.py`:
```python
"""Jarvis-Neuro backend: bake pipeline, and later the agent server."""
```

Run: `cd backend && uv sync`
Expected: creates `.venv` and installs dependencies without errors.

- [ ] **Step 2: Write the failing test**

`backend/tests/test_labels.py`:
```python
import numpy as np
import pytest

from jarvis_neuro.labels import (
    ED, ET, NCR, exclusive_from_channels, label_map_from_dataset_json, remap,
)

MSD_LABELS = {"0": "background", "1": "edema", "2": "non-enhancing tumor", "3": "enhancing tumour"}


def test_msd_names_map_to_our_convention():
    assert label_map_from_dataset_json(MSD_LABELS) == {1: ED, 2: NCR, 3: ET}


def test_non_enhancing_is_not_mistaken_for_enhancing():
    m = label_map_from_dataset_json({"0": "background", "1": "enhancing", "2": "non-enhancing", "3": "edema"})
    assert m == {1: ET, 2: NCR, 3: ED}


def test_unknown_label_fails_loudly():
    with pytest.raises(ValueError, match="LABEL_UNKNOWN"):
        label_map_from_dataset_json({"0": "background", "1": "edema", "2": "cyst"})


def test_incomplete_labels_fail_loudly():
    with pytest.raises(ValueError, match="LABEL_INCOMPLETE"):
        label_map_from_dataset_json({"0": "background", "1": "edema"})


def test_remap_applies_mapping_and_rejects_unmapped_values():
    seg = np.array([[0, 1], [2, 3]])
    assert remap(seg, {1: ET, 2: NCR, 3: ED}).tolist() == [[0, ET], [NCR, ED]]
    with pytest.raises(ValueError, match="LABEL_UNMAPPED"):
        remap(np.array([0, 4]), {1: ED})


def test_channels_become_exclusive_labels():
    wt = np.zeros(9, bool); wt[1:8] = True
    tc = np.zeros(9, bool); tc[2:7] = True
    et = np.zeros(9, bool); et[3:5] = True
    out = exclusive_from_channels(tc, wt, et)
    assert out.tolist() == [0, ED, NCR, ET, ET, NCR, NCR, ED, 0]
    assert ((out > 0) == wt).all()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_labels.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.labels'`

- [ ] **Step 4: Write minimal implementation**

`backend/src/jarvis_neuro/labels.py`:
```python
"""Label conventions. Output labels follow MSD Task01: 1 edema, 2 non-enhancing (necrotic) core, 3 enhancing."""
import numpy as np

ED, NCR, ET = 1, 2, 3
TUMOR_LABELS = (ET, NCR, ED)
ASSET_BY_LABEL = {ET: "tumor_et", NCR: "tumor_ncr", ED: "tumor_ed"}
LABEL_BY_ASSET = {v: k for k, v in ASSET_BY_LABEL.items()}
COLOR_BY_LABEL = {ET: "#E8705A", NCR: "#7A2E3A", ED: "#E3A857"}


def label_map_from_dataset_json(labels: dict[str, str]) -> dict[int, int]:
    """Map source label values to ours by name. Fails loudly on anything unrecognised."""
    out: dict[int, int] = {}
    for value, name in labels.items():
        v, n = int(value), name.lower()
        if v == 0:
            continue
        if "edema" in n or "oedema" in n:
            out[v] = ED
        elif "non-enhancing" in n or "necrotic" in n:   # before "enhancing": it is a substring
            out[v] = NCR
        elif "enhancing" in n:
            out[v] = ET
        else:
            raise ValueError(f"LABEL_UNKNOWN: {value}={name!r}")
    if sorted(out.values()) != [ED, NCR, ET]:
        raise ValueError(f"LABEL_INCOMPLETE: {labels}")
    return out


def remap(seg: np.ndarray, mapping: dict[int, int]) -> np.ndarray:
    seg = np.asarray(seg).astype(np.int64)
    unknown = set(np.unique(seg).tolist()) - {0} - set(mapping)
    if unknown:
        raise ValueError(f"LABEL_UNMAPPED: {sorted(unknown)}")
    lut = np.zeros(int(seg.max(initial=0)) + 1, np.uint8)
    for k, v in mapping.items():
        if k < lut.size:
            lut[k] = v
    return lut[seg]


def exclusive_from_channels(tc: np.ndarray, wt: np.ndarray, et: np.ndarray) -> np.ndarray:
    """Overlapping TC/WT/ET channels → exclusive labels: ED = WT−TC, NCR = TC−ET, ET = ET."""
    out = np.zeros(wt.shape, np.uint8)
    out[wt] = ED
    out[tc] = NCR
    out[et] = ET
    return out
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_labels.py -v`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add .gitignore backend
git commit -m "feat(bake): scaffold backend package and label conventions"
```

---

### Task 2: Geometry: affine meshing with correct winding

**Files:**
- Create: `backend/src/jarvis_neuro/geometry.py`
- Test: `backend/tests/test_geometry.py`

**Interfaces:**
- Produces:
  - `RAS2GL: np.ndarray (4,4)`
  - `apply_affine(m: np.ndarray(4,4), pts: np.ndarray(N,3)) -> np.ndarray(N,3)`
  - `signed_volume(verts, faces) -> float` (positive when the faces wind outward)
  - `mesh_from_mask(mask: bool(I,J,K), vox2ras: (4,4), sigma: float = 0.0, to_gl: bool = True) -> (verts float32 (N,3), faces uint32 (M,3))`.
    Returns empty arrays `(0,3)` when the mask is empty or blurs away.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_geometry.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_geometry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.geometry'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/geometry.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_geometry.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/jarvis_neuro/geometry.py backend/tests/test_geometry.py
git commit -m "feat(bake): mesh voxel masks through the affine with outward winding"
```

---

### Task 3: Smoothing, decimation and GLB output

**Files:**
- Create: `backend/src/jarvis_neuro/meshing.py`, `backend/src/jarvis_neuro/glb.py`
- Test: `backend/tests/test_meshing.py`

**Interfaces:**
- Consumes: `mesh_from_mask`, `signed_volume` (Task 2)
- Produces:
  - `smooth_and_decimate(verts, faces, target_faces: int, iterations: int = 10) -> (float32 verts, uint32 faces)`
  - `write_glb(nodes: list[tuple[str, np.ndarray, np.ndarray]], path: Path) -> None`. The node name is the asset ID.
  - `draco_compress(path: Path) -> None` (in place, needs `npx`)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_meshing.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_meshing.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.glb'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/meshing.py`:
```python
import fast_simplification
import numpy as np
import trimesh

from .geometry import signed_volume


def smooth_and_decimate(verts: np.ndarray, faces: np.ndarray, target_faces: int, iterations: int = 10):
    """Taubin smoothing (does not shrink, unlike Laplacian), then quadric decimation to about target_faces."""
    if len(faces) == 0:
        return verts.astype(np.float32), faces.astype(np.uint32)
    mesh = trimesh.Trimesh(verts, faces, process=False)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=0.53, iterations=iterations)
    v, f = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    if len(f) > target_faces:
        v, f = fast_simplification.simplify(v, f, target_reduction=1 - target_faces / len(f))
    v, f = np.asarray(v, np.float32), np.asarray(f, np.uint32)
    if signed_volume(v, f) < 0:
        f = f[:, ::-1].copy()
    return v, f
```

`backend/src/jarvis_neuro/glb.py`:
```python
import subprocess
from pathlib import Path

import numpy as np
import trimesh


def write_glb(nodes: list[tuple[str, np.ndarray, np.ndarray]], path: Path) -> None:
    """One glTF node per asset, named by asset id. Vertices are written as given (glTF frame, millimetres)."""
    scene = trimesh.Scene()
    for name, v, f in nodes:
        scene.add_geometry(trimesh.Trimesh(v, f, process=False), node_name=name, geom_name=name)
    Path(path).write_bytes(scene.export(file_type="glb"))


def draco_compress(path: Path) -> None:
    path = Path(path)
    tmp = path.with_suffix(".draco.glb")
    subprocess.run(["npx", "--yes", "@gltf-transform/cli", "draco", str(path), str(tmp)], check=True)
    tmp.replace(path)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_meshing.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/jarvis_neuro/meshing.py backend/src/jarvis_neuro/glb.py backend/tests/test_meshing.py
git commit -m "feat(bake): Taubin smoothing, quadric decimation and named-node GLB output"
```

---

### Task 4: Voxel statistics

**Files:**
- Create: `backend/src/jarvis_neuro/stats.py`
- Test: `backend/tests/test_stats.py`

**Interfaces:**
- Consumes: `apply_affine` (Task 2)
- Produces (all take a `bool` mask and a `(4,4)` vox2ras):
  - `voxel_sizes(vox2ras) -> np.ndarray(3)`
  - `volume_ml(mask, vox2ras) -> float`
  - `centroid_ras(mask, vox2ras) -> np.ndarray(3)`
  - `bbox_ras(mask, vox2ras) -> (np.ndarray(3) lo, np.ndarray(3) hi)` (voxel centres)
  - `min_dist_surface_mm(tumor, brain, vox2ras) -> float`
  - `midline_x_ras(brain, vox2ras) -> float`
  - `dice_score(a, b) -> float | None`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_stats.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_stats.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.stats'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/stats.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_stats.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/jarvis_neuro/stats.py backend/tests/test_stats.py
git commit -m "feat(bake): voxel-based volume, centroid, bbox, surface distance, midline and Dice"
```

---

### Task 5: uint8 volumes for the 2D panel

**Files:**
- Create: `backend/src/jarvis_neuro/volumes.py`
- Test: `backend/tests/test_volumes.py`

**Interfaces:**
- Produces:
  - `window_to_u8(vol: float (I,J,K), brain: bool (I,J,K), lo_pct=1.0, hi_pct=99.0) -> uint8 (I,J,K)` (0 outside the brain)
  - `write_bin(arr, path) -> None` (C-order raw bytes)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_volumes.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_volumes.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.volumes'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/volumes.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_volumes.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/jarvis_neuro/volumes.py backend/tests/test_volumes.py
git commit -m "feat(bake): window FLAIR to uint8 and write C-order volume bins"
```

---

### Task 6: Manifest contract, JSON Schema and case index

**Files:**
- Create: `backend/src/jarvis_neuro/manifest.py`
- Create (generated): `shared/manifest.schema.json`
- Test: `backend/tests/test_manifest.py`

**Interfaces:**
- Consumes: `LABEL_BY_ASSET` (Task 1), `RAS2GL` (Task 2)
- Produces:
  - `Provenance = Literal["ground-truth", "monai-segresnet", "synthetic"]`
  - `SurfaceAsset(id="brain_surface", node, kind="surface")`
  - `TumorAsset(id, label, node, kind="tumor", color, volume_ml, centroid_ras, bbox_ras, min_dist_surface_mm)`
  - `Volumes(flair, mask)`, `Metrics(dice_vs_gt: dict[str,float] | None)`
  - `Manifest(case_id, provenance, dims, vox2ras, ras2gl, midline_x_ras, volumes, glb, assets, metrics)`
  - `CaseIndex(cases: list[IndexEntry(case_id, provenance, path)])`
  - `update_index(out_root: Path, m: Manifest, rel_path: str) -> CaseIndex`
  - `SCHEMA_PATH: Path`, `write_schema(path=SCHEMA_PATH) -> None`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_manifest.py`:
```python
import json

import numpy as np
import pytest
from pydantic import ValidationError

from jarvis_neuro.geometry import RAS2GL
from jarvis_neuro.manifest import (
    SCHEMA_PATH, Manifest, Metrics, SurfaceAsset, TumorAsset, Volumes, update_index,
)


def et_asset(**over):
    base = dict(id="tumor_et", label=3, node="tumor_et", color="#E8705A", volume_ml=1.2,
                centroid_ras=(1.0, 2.0, 3.0), bbox_ras=((0.0, 0.0, 0.0), (2.0, 2.0, 2.0)), min_dist_surface_mm=4.0)
    base.update(over)
    return TumorAsset(**base)


def sample(**over):
    base = dict(
        case_id="synth_001", provenance="synthetic", dims=(4, 5, 6),
        vox2ras=np.eye(4).ravel().tolist(), ras2gl=RAS2GL.ravel().tolist(), midline_x_ras=0.0,
        volumes=Volumes(flair="flair_u8.bin", mask="mask_u8.bin"), glb="case.glb",
        assets=[SurfaceAsset(id="brain_surface", node="brain_surface"), et_asset()], metrics=Metrics(),
    )
    base.update(over)
    return Manifest(**base)


def test_round_trip():
    m = sample()
    assert Manifest.model_validate_json(m.model_dump_json()) == m


def test_rejects_bad_matrix_and_unknown_fields():
    with pytest.raises(ValidationError):
        sample(vox2ras=[1.0, 0.0, 0.0])
    with pytest.raises(ValidationError):
        Manifest.model_validate({**json.loads(sample().model_dump_json()), "extra": 1})


def test_tumor_label_must_match_id():
    with pytest.raises(ValidationError, match="label"):
        et_asset(label=1)


def test_schema_file_is_current():
    assert json.loads(SCHEMA_PATH.read_text()) == Manifest.model_json_schema()


def test_index_upserts_by_case_and_provenance(tmp_path):
    update_index(tmp_path, sample(), "synth_001/synthetic/manifest.json")
    update_index(tmp_path, sample(), "synth_001/synthetic/manifest.json")
    idx = update_index(tmp_path, sample(provenance="monai-segresnet"), "synth_001/monai-segresnet/manifest.json")
    assert [(e.case_id, e.provenance) for e in idx.cases] == [
        ("synth_001", "monai-segresnet"), ("synth_001", "synthetic")]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.manifest'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/manifest.py`:
```python
"""The manifest contract shared with the viewer (zod) and the agents. Source of shared/manifest.schema.json."""
import json
from pathlib import Path
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .labels import LABEL_BY_ASSET

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "shared" / "manifest.schema.json"

Provenance = Literal["ground-truth", "monai-segresnet", "synthetic"]
Vec3 = tuple[float, float, float]
Matrix4 = Annotated[list[float], Field(min_length=16, max_length=16)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SurfaceAsset(_Strict):
    id: Literal["brain_surface"]
    node: str
    kind: Literal["surface"] = "surface"


class TumorAsset(_Strict):
    id: Literal["tumor_et", "tumor_ncr", "tumor_ed"]
    label: Literal[1, 2, 3]
    node: str
    kind: Literal["tumor"] = "tumor"
    color: Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
    volume_ml: Annotated[float, Field(ge=0)]
    centroid_ras: Vec3
    bbox_ras: tuple[Vec3, Vec3]
    min_dist_surface_mm: Annotated[float, Field(ge=0)]

    @model_validator(mode="after")
    def _label_matches_id(self):
        if LABEL_BY_ASSET[self.id] != self.label:
            raise ValueError(f"label {self.label} does not match {self.id}")
        return self


Asset = Annotated[Union[SurfaceAsset, TumorAsset], Field(discriminator="kind")]


class Volumes(_Strict):
    flair: str
    mask: str


class Metrics(_Strict):
    dice_vs_gt: dict[str, float] | None = None


class Manifest(_Strict):
    case_id: Annotated[str, Field(pattern=r"^[a-z0-9_]+$")]
    provenance: Provenance
    dims: tuple[int, int, int]
    vox2ras: Matrix4
    ras2gl: Matrix4
    midline_x_ras: float
    volumes: Volumes
    glb: str
    assets: list[Asset]
    metrics: Metrics


class IndexEntry(_Strict):
    case_id: str
    provenance: Provenance
    path: str


class CaseIndex(_Strict):
    cases: list[IndexEntry] = []


def update_index(out_root: Path, m: Manifest, rel_path: str) -> CaseIndex:
    p = Path(out_root) / "index.json"
    idx = CaseIndex.model_validate_json(p.read_text()) if p.exists() else CaseIndex()
    entries = [e for e in idx.cases if (e.case_id, e.provenance) != (m.case_id, m.provenance)]
    entries.append(IndexEntry(case_id=m.case_id, provenance=m.provenance, path=rel_path))
    idx = CaseIndex(cases=sorted(entries, key=lambda e: (e.case_id, e.provenance)))
    p.write_text(idx.model_dump_json(indent=2))
    return idx


def write_schema(path: Path = SCHEMA_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(Manifest.model_json_schema(), indent=2) + "\n")


if __name__ == "__main__":
    write_schema()
    print(SCHEMA_PATH)
```

- [ ] **Step 4: Generate the schema, then run tests**

Run: `cd backend && uv run python -m jarvis_neuro.manifest && uv run pytest tests/test_manifest.py -v`
Expected: prints `.../jarvis-neuro/shared/manifest.schema.json`, then 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/jarvis_neuro/manifest.py backend/tests/test_manifest.py shared/manifest.schema.json
git commit -m "feat(bake): manifest contract with JSON Schema export and case index"
```

---

### Task 7: MSD loader and synthetic fixture

**Files:**
- Create: `backend/src/jarvis_neuro/io_msd.py`, `backend/src/jarvis_neuro/synthetic.py`
- Test: `backend/tests/test_io.py`

**Interfaces:**
- Consumes: `label_map_from_dataset_json`, `remap`, `ED/NCR/ET` (Task 1), `centroid_ras`, `midline_x_ras` (Task 4)
- Produces:
  - `LoadedCase(case_id: str, image: float32 (I,J,K,C), modalities: dict[str,int], labels: uint8 (I,J,K) | None, vox2ras: float64 (4,4))`
    - `modalities` keys are lower-cased names from `dataset.json`, e.g. `flair`, `t1w`, `t1gd`, `t2w`.
  - `read_dataset_json(root: Path) -> (modalities, label_map)`
  - `load_msd_case(root: Path, name: str) -> LoadedCase`. `case_id = name.lower()`, and arrays are RAS-canonical.
  - `SYNTH_NAME = "SYNTH_001"`, `SYNTH_SHAPE = (56, 64, 48)`, `SYNTH_AFFINE` (LAS, 3 mm)
  - `make_synthetic_msd(root: Path, seed: int = 0) -> Path`. It writes the MSD layout (`dataset.json`, `imagesTr/`, `labelsTr/`).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_io.py`:
```python
import numpy as np

from jarvis_neuro.io_msd import load_msd_case
from jarvis_neuro.labels import ED, ET, NCR
from jarvis_neuro.stats import centroid_ras, midline_x_ras
from jarvis_neuro.synthetic import SYNTH_NAME, SYNTH_SHAPE, make_synthetic_msd


def test_synthetic_case_loads_canonical(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path), SYNTH_NAME)
    A = case.vox2ras
    assert case.case_id == "synth_001"
    assert (np.diag(A)[:3] > 0).all()                          # RAS after canonicalisation
    assert np.allclose(A[:3, :3], np.diag(np.diag(A)[:3]))
    assert case.image.shape == (*SYNTH_SHAPE, 4)
    assert set(case.modalities) == {"flair", "t1w", "t1gd", "t2w"}
    assert set(np.unique(case.labels).tolist()) == {0, ED, NCR, ET}


def test_synthetic_tumor_is_in_left_hemisphere(tmp_path):
    # Written with +i = left (LAS). A loader that drops the flip would put it on the right.
    case = load_msd_case(make_synthetic_msd(tmp_path), SYNTH_NAME)
    brain = (case.image != 0).any(-1)
    assert centroid_ras(case.labels > 0, case.vox2ras)[0] < midline_x_ras(brain, case.vox2ras)


def test_tumor_lies_inside_brain(tmp_path):
    case = load_msd_case(make_synthetic_msd(tmp_path), SYNTH_NAME)
    brain = (case.image != 0).any(-1)
    assert brain[case.labels > 0].all()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_io.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.io_msd'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/io_msd.py`:
```python
"""Load MSD Task01-layout cases, reoriented to RAS so slicing is plain array indexing."""
import json
from dataclasses import dataclass
from pathlib import Path

import nibabel as nib
import numpy as np

from .labels import label_map_from_dataset_json, remap


@dataclass(frozen=True)
class LoadedCase:
    case_id: str
    image: np.ndarray            # (I, J, K, C) float32, RAS-canonical
    modalities: dict[str, int]   # lower-cased dataset.json names → channel index
    labels: np.ndarray | None    # (I, J, K) uint8 in our convention
    vox2ras: np.ndarray          # (4, 4)


def read_dataset_json(root: Path) -> tuple[dict[str, int], dict[int, int]]:
    d = json.loads((Path(root) / "dataset.json").read_text())
    modalities = {name.lower(): int(k) for k, name in d["modality"].items()}
    return modalities, label_map_from_dataset_json(d["labels"])


def load_msd_case(root: Path, name: str) -> LoadedCase:
    root = Path(root)
    modalities, label_map = read_dataset_json(root)
    img = nib.as_closest_canonical(nib.load(root / "imagesTr" / f"{name}.nii.gz"))
    image = np.asarray(img.dataobj, dtype=np.float32)
    if image.ndim != 4 or image.shape[-1] != len(modalities):
        raise ValueError(f"MSD_SHAPE: {name} has shape {image.shape}, expected {len(modalities)} channels")
    labels = None
    label_path = root / "labelsTr" / f"{name}.nii.gz"
    if label_path.exists():
        lab = nib.as_closest_canonical(nib.load(label_path))
        if not np.allclose(lab.affine, img.affine, atol=1e-3):
            raise ValueError(f"MSD_AFFINE_MISMATCH: {name}")
        labels = remap(np.rint(np.asarray(lab.dataobj)), label_map)
    return LoadedCase(name.lower(), image, modalities, labels, img.affine.astype(np.float64))
```

`backend/src/jarvis_neuro/synthetic.py`:
```python
"""A tiny MSD-layout case: ellipsoid brain, layered tumor in the LEFT hemisphere, LAS 3 mm affine.
Generated, not a scan of anyone. Exercises reorientation (det < 0), all three labels and non-cubic axes."""
import json
from pathlib import Path

import nibabel as nib
import numpy as np

SYNTH_NAME = "SYNTH_001"
SYNTH_SHAPE = (56, 64, 48)
# +i is LEFT (x decreases), so canonicalisation must flip axis 0. Voxel (28, 32, 24) sits at RAS (0, 0, 0).
SYNTH_AFFINE = np.array([[-3.0, 0, 0, 84], [0, 3, 0, -96], [0, 0, 3, -72], [0, 0, 0, 1]])
DATASET_JSON = {
    "name": "SYNTH",
    "modality": {"0": "FLAIR", "1": "T1w", "2": "t1gd", "3": "T2w"},
    "labels": {"0": "background", "1": "edema", "2": "non-enhancing tumor", "3": "enhancing tumour"},
}


def make_synthetic_msd(root: Path, seed: int = 0) -> Path:
    root = Path(root)
    (root / "imagesTr").mkdir(parents=True, exist_ok=True)
    (root / "labelsTr").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    g = np.indices(SYNTH_SHAPE).astype(np.float32).transpose(1, 2, 3, 0)
    centre = np.array([28.0, 32.0, 24.0])
    brain = (((g - centre) / [24.0, 28.0, 20.0]) ** 2).sum(-1) <= 1.0
    r = np.sqrt(((g - (centre + [8.0, 4.0, 3.0])) ** 2).sum(-1))
    labels = np.zeros(SYNTH_SHAPE, np.uint8)
    labels[(r <= 7.0) & brain] = 1      # edema
    labels[r <= 5.5] = 3                # enhancing ring
    labels[r <= 4.0] = 2                # necrotic core
    base = np.where(brain, 100.0 + rng.normal(0, 5, SYNTH_SHAPE), 0.0)
    flair = base + 100.0 * (labels == 1)
    t1 = base - 30.0 * (labels > 0)
    t1gd = base + 120.0 * (labels == 3)
    t2 = base + 80.0 * (labels > 0)
    image = (np.stack([flair, t1, t1gd, t2], -1) * brain[..., None]).astype(np.float32)
    nib.save(nib.Nifti1Image(image, SYNTH_AFFINE), root / "imagesTr" / f"{SYNTH_NAME}.nii.gz")
    nib.save(nib.Nifti1Image(labels, SYNTH_AFFINE), root / "labelsTr" / f"{SYNTH_NAME}.nii.gz")
    (root / "dataset.json").write_text(json.dumps(DATASET_JSON, indent=2))
    return root
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_io.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/jarvis_neuro/io_msd.py backend/src/jarvis_neuro/synthetic.py backend/tests/test_io.py
git commit -m "feat(bake): RAS-canonical MSD loader and synthetic LAS fixture"
```

---

### Task 8: `bake_case`, CLI and committed synthetic fixture

**Files:**
- Create: `backend/src/jarvis_neuro/bake.py`
- Create (generated, committed): `frontend/public/cases/index.json`, `frontend/public/cases/synth_001/synthetic/*`
- Test: `backend/tests/test_bake.py`

**Interfaces:**
- Consumes: everything from Tasks 1–7
- Produces:
  - `BRAIN_TARGET_FACES = 100_000`, `TUMOR_TARGET_FACES = 20_000`
  - `brain_mask(case: LoadedCase, seg: np.ndarray) -> bool (I,J,K)`
  - `bake_case(case, seg, provenance, out_dir: Path, draco=False, gt=None) -> Manifest`
  - `main(argv: list[str] | None = None) -> None` with subcommands:
    - `synthetic --out DIR [--draco]`
    - `msd --root DIR --cases A,B --provenance P --out DIR [--bundle-dir DIR] [--draco]`
    - `survey --root DIR`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_bake.py`:
```python
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


def test_tumor_mesh_aligns_with_manifest_centroid(baked):
    """The alignment claim: GLB vertices and manifest numbers share one frame."""
    d, m, _ = baked
    scene = trimesh.load(d / "case.glb", force="scene")
    ras2gl = np.array(m.ras2gl).reshape(4, 4)
    for a in tumors(m):
        geom = scene.geometry[scene.graph[a.node][1]]
        expected = apply_affine(ras2gl, np.array([a.centroid_ras]))[0]
        assert np.allclose(geom.vertices.mean(0), expected, atol=4.5), a.id   # 1.5 voxels of 3 mm


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


def test_cli_synthetic_writes_index(tmp_path):
    main(["synthetic", "--out", str(tmp_path)])
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx["cases"] == [{"case_id": "synth_001", "provenance": "synthetic",
                             "path": "synth_001/synthetic/manifest.json"}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_bake.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.bake'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/bake.py`:
```python
"""Bake one case: meshes + uint8 volumes + manifest. CLI: python -m jarvis_neuro.bake {synthetic,msd,survey}."""
import argparse
import tempfile
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy.ndimage import binary_fill_holes

from .geometry import RAS2GL, mesh_from_mask
from .glb import draco_compress, write_glb
from .io_msd import LoadedCase, load_msd_case, read_dataset_json
from .labels import ASSET_BY_LABEL, COLOR_BY_LABEL, TUMOR_LABELS, remap
from .manifest import Manifest, Metrics, SurfaceAsset, TumorAsset, Volumes, update_index
from .meshing import smooth_and_decimate
from .stats import bbox_ras, centroid_ras, dice_score, midline_x_ras, min_dist_surface_mm, volume_ml
from .synthetic import SYNTH_NAME, make_synthetic_msd
from .volumes import window_to_u8, write_bin

BRAIN_TARGET_FACES = 100_000
TUMOR_TARGET_FACES = 20_000


def brain_mask(case: LoadedCase, seg: np.ndarray) -> np.ndarray:
    return binary_fill_holes((case.image != 0).any(-1)) | (seg > 0)


def _vec(a) -> tuple[float, float, float]:
    return (float(a[0]), float(a[1]), float(a[2]))


def bake_case(case: LoadedCase, seg: np.ndarray, provenance: str, out_dir: Path,
              draco: bool = False, gt: np.ndarray | None = None) -> Manifest:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    A = case.vox2ras
    brain = brain_mask(case, seg)

    v, f = smooth_and_decimate(*mesh_from_mask(brain, A, sigma=1.0), BRAIN_TARGET_FACES)
    nodes = [("brain_surface", v, f)]
    assets: list = [SurfaceAsset(id="brain_surface", node="brain_surface")]
    for label in TUMOR_LABELS:
        m = seg == label
        if not m.any():
            continue
        v, f = smooth_and_decimate(*mesh_from_mask(m, A, sigma=0.5), TUMOR_TARGET_FACES)
        if len(f) == 0:
            continue
        name = ASSET_BY_LABEL[label]
        nodes.append((name, v, f))
        lo, hi = bbox_ras(m, A)
        assets.append(TumorAsset(
            id=name, label=label, node=name, color=COLOR_BY_LABEL[label],
            volume_ml=volume_ml(m, A), centroid_ras=_vec(centroid_ras(m, A)), bbox_ras=(_vec(lo), _vec(hi)),
            min_dist_surface_mm=min_dist_surface_mm(m, brain, A),
        ))

    write_glb(nodes, out_dir / "case.glb")
    if draco:
        draco_compress(out_dir / "case.glb")
    write_bin(window_to_u8(case.image[..., case.modalities["flair"]], brain), out_dir / "flair_u8.bin")
    write_bin(seg, out_dir / "mask_u8.bin")

    dice = None
    if gt is not None:
        scores = {ASSET_BY_LABEL[l]: dice_score(seg == l, gt == l) for l in TUMOR_LABELS}
        dice = {k: s for k, s in scores.items() if s is not None}

    manifest = Manifest(
        case_id=case.case_id, provenance=provenance, dims=tuple(int(n) for n in seg.shape),
        vox2ras=A.ravel().tolist(), ras2gl=RAS2GL.ravel().tolist(), midline_x_ras=midline_x_ras(brain, A),
        volumes=Volumes(flair="flair_u8.bin", mask="mask_u8.bin"), glb="case.glb",
        assets=assets, metrics=Metrics(dice_vs_gt=dice),
    )
    (out_dir / "manifest.json").write_text(manifest.model_dump_json(indent=2))
    return manifest


def _bake_one(root: Path, name: str, provenance: str, out: Path, draco: bool, segmenter) -> None:
    case = load_msd_case(root, name)
    if segmenter is None:
        if case.labels is None:
            raise SystemExit(f"{name}: no ground-truth labels")
        seg, gt = case.labels, None
    else:
        seg, gt = segmenter.segment(case), case.labels
    rel = f"{case.case_id}/{provenance}"
    m = bake_case(case, seg, provenance, out / rel, draco=draco, gt=gt)
    update_index(out, m, f"{rel}/manifest.json")
    print(f"{rel}: {[a.id for a in m.assets]} dice={m.metrics.dice_vs_gt}")


def _survey(root: Path) -> None:
    """One line per case to help pick demo cases: whole-tumor mL and side relative to the volume centre."""
    _, label_map = read_dataset_json(root)
    print("case\twt_ml\tside")
    for p in sorted((root / "labelsTr").glob("*.nii.gz")):
        if p.name.startswith("._"):
            continue
        img = nib.as_closest_canonical(nib.load(p))
        wt = remap(np.rint(np.asarray(img.dataobj)), label_map) > 0
        if not wt.any():
            continue
        A = img.affine
        cx = centroid_ras(wt, A)[0]
        mid = (A[0, 3] + A[0, 0] * (wt.shape[0] - 1) / 2)
        print(f"{p.name.removesuffix('.nii.gz')}\t{volume_ml(wt, A):.1f}\t{'left' if cx < mid else 'right'}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m jarvis_neuro.bake")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("synthetic")
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--draco", action="store_true")
    m = sub.add_parser("msd")
    m.add_argument("--root", type=Path, required=True)
    m.add_argument("--cases", required=True, help="comma-separated, e.g. BRATS_001,BRATS_042")
    m.add_argument("--provenance", choices=["ground-truth", "monai-segresnet"], required=True)
    m.add_argument("--bundle-dir", type=Path, default=Path("data/bundles"))
    m.add_argument("--out", type=Path, required=True)
    m.add_argument("--draco", action="store_true")
    v = sub.add_parser("survey")
    v.add_argument("--root", type=Path, required=True)
    a = p.parse_args(argv)

    if a.cmd == "synthetic":
        with tempfile.TemporaryDirectory() as tmp:
            _bake_one(make_synthetic_msd(Path(tmp)), SYNTH_NAME, "synthetic", a.out, a.draco, None)
    elif a.cmd == "survey":
        _survey(a.root)
    else:
        segmenter = None
        if a.provenance == "monai-segresnet":
            from .segment_monai import MonaiSegmenter
            segmenter = MonaiSegmenter(a.bundle_dir)
        for name in a.cases.split(","):
            _bake_one(a.root, name.strip(), a.provenance, a.out, a.draco, segmenter)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_bake.py -v`
Expected: 8 passed

- [ ] **Step 5: Bake and commit the synthetic fixture for Plans B and C**

Run: `cd backend && uv run python -m jarvis_neuro.bake synthetic --out ../frontend/public/cases && ls -la ../frontend/public/cases/synth_001/synthetic`
Expected: prints `synth_001/synthetic: ['brain_surface', 'tumor_et', 'tumor_ncr', 'tumor_ed'] dice=None`. The listing
shows `case.glb`, two `.bin` files of 172032 bytes each (56×64×48), and `manifest.json`.

- [ ] **Step 6: Run the full suite**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass (38: Tasks 1–8)

- [ ] **Step 7: Commit**

```bash
git add backend/src/jarvis_neuro/bake.py backend/tests/test_bake.py frontend/public/cases
git commit -m "feat(bake): bake_case, CLI and committed synthetic fixture"
```

---

### Task 9: Optional MONAI segmentation

**Files:**
- Create: `backend/src/jarvis_neuro/segment_monai.py`
- Test: `backend/tests/test_segment_monai.py`

**Interfaces:**
- Consumes: `exclusive_from_channels` (Task 1), `LoadedCase` (Task 7). `bake.main` imports `MonaiSegmenter` lazily (Task 8).
- Produces:
  - `BUNDLE = "brats_mri_segmentation"`, `INPUT_ORDER: tuple[str, ...]`, `OUTPUT_ORDER: tuple[str, ...]`
  - `channels_to_labels(prob: (3, ...), output_order=OUTPUT_ORDER, threshold=0.5) -> uint8`
  - `order_channels(image: (I,J,K,C), modalities, input_order) -> (C', I, J, K)`
  - `MonaiSegmenter(bundle_dir: Path, device: str | None = None)` with `.segment(case: LoadedCase) -> uint8 (I,J,K)`

- [ ] **Step 1: Write the failing test** (pure numpy, so no torch needed)

`backend/tests/test_segment_monai.py`:
```python
import numpy as np
import pytest

from jarvis_neuro.labels import ED, ET, NCR
from jarvis_neuro.segment_monai import channels_to_labels, order_channels


def test_channels_to_labels_uses_named_order():
    prob = np.zeros((3, 5))                 # tc, wt, et
    prob[1, 0:5] = 0.9
    prob[0, 1:4] = 0.9
    prob[2, 2] = 0.9
    assert channels_to_labels(prob, ("tc", "wt", "et")).tolist() == [ED, NCR, ET, NCR, ED]


def test_order_channels_refuses_unset_order():
    with pytest.raises(ValueError, match="MONAI_INPUT_ORDER"):
        order_channels(np.zeros((2, 2, 2, 4)), {"flair": 0}, ())


def test_order_channels_stacks_requested_modalities():
    img = np.stack([np.full((2, 2, 2), v, np.float32) for v in range(4)], -1)
    out = order_channels(img, {"flair": 0, "t1w": 1, "t1gd": 2, "t2w": 3}, ("t1gd", "t1w", "t2w", "flair"))
    assert out[:, 0, 0, 0].tolist() == [2, 1, 3, 0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_segment_monai.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jarvis_neuro.segment_monai'`

- [ ] **Step 3: Write minimal implementation**

`backend/src/jarvis_neuro/segment_monai.py`:
```python
"""MONAI brats_mri_segmentation bundle. Optional extra: `uv sync --extra monai`.

INPUT_ORDER and OUTPUT_ORDER must match the bundle's configs/metadata.json (Task 9, step 5). A wrong order fails
silently, which is why every monai-segresnet bake records Dice against ground truth."""
from pathlib import Path

import numpy as np

from .labels import exclusive_from_channels

BUNDLE = "brats_mri_segmentation"
INPUT_ORDER: tuple[str, ...] = ()                    # set from metadata.json in step 5; empty refuses to run
OUTPUT_ORDER: tuple[str, ...] = ("tc", "wt", "et")   # confirm in step 5


def channels_to_labels(prob: np.ndarray, output_order: tuple[str, ...] = OUTPUT_ORDER,
                       threshold: float = 0.5) -> np.ndarray:
    ch = {name: prob[i] > threshold for i, name in enumerate(output_order)}
    return exclusive_from_channels(ch["tc"], ch["wt"], ch["et"])


def order_channels(image: np.ndarray, modalities: dict[str, int], input_order: tuple[str, ...]) -> np.ndarray:
    missing = [m for m in input_order if m not in modalities]
    if not input_order or missing:
        raise ValueError(f"MONAI_INPUT_ORDER: set INPUT_ORDER from the bundle metadata (missing {missing})")
    return np.stack([image[..., modalities[m]] for m in input_order], 0)


class MonaiSegmenter:
    def __init__(self, bundle_dir: Path, device: str | None = None):
        import torch
        from monai.bundle import ConfigParser, download

        self._torch = torch
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        root = Path(bundle_dir) / BUNDLE
        if not root.exists():
            download(name=BUNDLE, bundle_dir=str(bundle_dir))
        parser = ConfigParser()
        parser.read_meta(str(root / "configs" / "metadata.json"))
        parser.read_config(str(root / "configs" / "inference.json"))
        parser["bundle_root"] = str(root)
        self.net = parser.get_parsed_content("network_def")
        self.net.load_state_dict(torch.load(root / "models" / "model.pt", map_location=self.device))
        self.net.to(self.device).eval()
        self.inferer = parser.get_parsed_content("inferer")

    def segment(self, case) -> np.ndarray:
        from monai.transforms import NormalizeIntensity

        x = self._torch.from_numpy(order_channels(case.image, case.modalities, INPUT_ORDER))
        x = NormalizeIntensity(nonzero=True, channel_wise=True)(x).unsqueeze(0).to(self.device)
        with self._torch.no_grad():
            prob = self._torch.sigmoid(self.inferer(x, self.net))[0].cpu().numpy()
        return channels_to_labels(prob)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_segment_monai.py -v`
Expected: 3 passed

- [ ] **Step 5: Set INPUT_ORDER and OUTPUT_ORDER from the real bundle**

Run:
```bash
cd backend && uv sync --extra monai && mkdir -p ../data/bundles && uv run python -c "
from monai.bundle import download; download(name='brats_mri_segmentation', bundle_dir='../data/bundles')" && \
uv run python -c "
import json; m = json.load(open('../data/bundles/brats_mri_segmentation/configs/metadata.json'))
print(json.dumps(m['network_data_format'], indent=2))
c = json.load(open('../data/bundles/brats_mri_segmentation/configs/inference.json'))
print(json.dumps(c.get('preprocessing'), indent=2)); print(json.dumps(c.get('inferer'), indent=2))"
```
Expected: printed `inputs.image` and `outputs.pred` descriptions, plus the bundle's preprocessing and inferer config.

Then:
- Set `INPUT_ORDER` to the input modality order stated there, using our lower-case names (`flair`, `t1w`, `t1gd`, `t2w`).
- Set `OUTPUT_ORDER` to the stated output channel order (`tc`, `wt`, `et` in whatever order the metadata gives).
- If the printed preprocessing does more than nonzero channel-wise intensity normalisation on 1 mm RAS input (for
  example a different spacing or a crop), copy those transforms into `segment()` before the inferer call.

- [ ] **Step 6: Sanity-check on 3 cases with ground truth** (after Task 10 step 1 has downloaded MSD)

Run: `cd backend && uv run python -m jarvis_neuro.bake msd --root ../data/Task01_BrainTumour --cases BRATS_001,BRATS_002,BRATS_003 --provenance monai-segresnet --out /tmp/monai-check`
Expected: each line prints a `dice=` dict. Acceptance: `tumor_ed`, `tumor_ncr` and `tumor_et` are not all near 0, and
whole-tumor overlap is visibly good in the viewer. The 0.7 bar used here is a sanity threshold, not a quality claim. If
Dice is near 0 everywhere, `INPUT_ORDER` or `OUTPUT_ORDER` is wrong: fix it, then rerun.

- [ ] **Step 7: Commit**

```bash
git add backend/src/jarvis_neuro/segment_monai.py backend/tests/test_segment_monai.py backend/uv.lock
git commit -m "feat(bake): optional MONAI SegResNet segmentation with verified channel order"
```

---

### Task 10: Fetch MSD, pick demo cases, bake, attribute

**Files:**
- Create: `scripts/fetch_msd.sh`, `frontend/public/cases/ATTRIBUTION.md`
- Create (generated, committed): `frontend/public/cases/<case_id>/{ground-truth,monai-segresnet}/*`

**Interfaces:**
- Consumes: `python -m jarvis_neuro.bake {survey,msd}` (Task 8), `MonaiSegmenter` (Task 9)
- Produces: 3–5 real cases in `frontend/public/cases/index.json`, which Plans B and C load by `case_id`

- [ ] **Step 1: Write and run the fetch script** (download is large, roughly 7 GB; run it in the background)

`scripts/fetch_msd.sh`:
```bash
#!/usr/bin/env bash
# Medical Segmentation Decathlon Task01_BrainTumour (CC-BY-SA 4.0). Resumable.
set -euo pipefail
DEST="${1:-data}"
URL="https://msd-for-monai.s3-us-west-2.amazonaws.com/Task01_BrainTumour.tar"
mkdir -p "$DEST"
curl -fL -C - -o "$DEST/Task01_BrainTumour.tar" "$URL"
tar -xf "$DEST/Task01_BrainTumour.tar" -C "$DEST"
find "$DEST/Task01_BrainTumour" -name '._*' -delete      # macOS resource forks shipped in the tar
echo "imagesTr: $(ls "$DEST/Task01_BrainTumour/imagesTr" | wc -l | tr -d ' ') files"
```

Run: `chmod +x scripts/fetch_msd.sh && ./scripts/fetch_msd.sh data`
Expected: ends with `imagesTr: <n> files`. n should be in the hundreds; the published training-set count is 484. Also
`data/Task01_BrainTumour/dataset.json` exists.

- [ ] **Step 2: Confirm the labels match our mapping**

Run: `cd backend && uv run python -c "from jarvis_neuro.io_msd import read_dataset_json; print(read_dataset_json('../data/Task01_BrainTumour'))"`
Expected: modalities include `flair`, and the label map is `{1: 1, 2: 2, 3: 3}`. If the map differs, the name-based
mapping has handled it. If it raises `LABEL_UNKNOWN` or `LABEL_INCOMPLETE`, stop and inspect `dataset.json`.

- [ ] **Step 3: Survey and pick cases**

Run: `cd backend && uv run python -m jarvis_neuro.bake survey --root ../data/Task01_BrainTumour > ../data/survey.tsv && sort -t$'\t' -k2 -n ../data/survey.tsv | awk 'NR%60==2'`
Expected: a spread of cases from small to large whole-tumor volume, with sides. Pick 3–5 that cover both sides and
a range of sizes, and write them comma-separated into `data/demo_cases.txt`.

- [ ] **Step 4: Bake ground truth, then MONAI**

Run:
```bash
cd backend
CASES=$(cat ../data/demo_cases.txt)
uv run python -m jarvis_neuro.bake msd --root ../data/Task01_BrainTumour --cases "$CASES" --provenance ground-truth --out ../frontend/public/cases --draco
uv run python -m jarvis_neuro.bake msd --root ../data/Task01_BrainTumour --cases "$CASES" --provenance monai-segresnet --out ../frontend/public/cases --draco
du -sh ../frontend/public/cases/*/*
```
Expected: one line per case and provenance. MONAI lines show a `dice=` dict. Each directory holds about 18 MB of raw
bins plus a GLB of a few MB (exact sizes unknown until run). Drop any case whose MONAI output looks wrong when viewed,
rather than tuning it.

- [ ] **Step 5: Attribution**

`frontend/public/cases/ATTRIBUTION.md`:
```markdown
# Case data

`brats_*` cases are derived from the Medical Segmentation Decathlon, Task01_BrainTumour, which is itself derived from
BRATS 2016 and 2017. Licence: CC-BY-SA 4.0 (confirm on http://medicaldecathlon.com before publishing). Derived files
(meshes, uint8 volumes, manifests) are shared under the same licence.

- Simpson et al., "A large annotated medical image dataset for the development and evaluation of segmentation
  algorithms", arXiv:1902.09063, 2019.
- Antonelli et al., "The Medical Segmentation Decathlon", Nature Communications 13, 4128, 2022.

`synth_001` is generated by `backend/src/jarvis_neuro/synthetic.py`. It is not a scan of anyone.

Educational visualization only. Not for diagnosis or surgical planning.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch_msd.sh frontend/public/cases
git commit -m "feat(bake): fetch MSD Task01 and bake demo cases with attribution"
```

---

## Next plans

- **Plan B: Viewer** (`frontend/`). Vite + React + r3f. It loads `index.json`, `manifest.json`, `case.glb` and the
  `.bin` volumes, renders with the 0.45 brain-opacity rules, and links the 2D slice panel through `vox2ras`. It also
  adds gestures (the four docx fixes) and zod mirrors of `shared/manifest.schema.json`. `tumor_ed` is a shell around
  the core, so it must render translucent or the inner regions are hidden. Builds against `synth_001` from Task 8.
- **Plan C: Agents** (`backend/`). FastAPI with a WebSocket tool bridge, plus a Strands Orchestrator and Reasoner behind
  the provider factory, plus `load_case` reading the manifests. Builds against `synth_001` from Task 8.
