# Brain Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the brain look like a real, see-through cortex (pink gyri, darker sulci, soft rim), in the style of the BrainFacts / MSD Manuals 3D brains, using the patient's own MRI; and settle, with evidence, which openly licensed atlas can label brain regions later.

**Architecture:** Today `brain_surface` is meshed from "any modality non-zero, holes filled", smoothed with σ = 1 mm. That is the skull-stripping envelope: a smooth blob with no gyri, and no shader can draw sulci the geometry does not have. Task 1 re-meshes it from the T1 intensity inside the brain (the grey-matter/CSF boundary), which follows the folds. Task 2 shades it per vertex by how concave it is (sulci dark, gyri light) with a warmer translucent material. Task 3 is a report-only spike for the atlas plan that follows.

**Tech Stack:** Python 3.12, numpy, scipy, scikit-image `marching_cubes`, trimesh, fast_simplification, pytest (backend, `uv run`). three 0.186, vitest (frontend).

## Global Constraints

- Educational visualization, not for diagnosis (spec §10). No anatomical names are added in this plan.
- The BrainFacts, MSD Manuals and neurotorium pages are style references only. Copy no asset, texture, colour table or text from them.
- Asset ids, the manifest schema and `shared/manifest.schema.json` do not change. `brain_surface` keeps its id and node name.
- Do not touch `frontend/src/gestures/`, `frontend/src/scene/picking.ts`, `GesturePicker.tsx`, `CameraRig.tsx`, `ViewportPanel.tsx`: another branch rewrites them now. `frontend/src/scene/prepare.ts` may change only in the one place Task 2 names.
- The committed `synth_001` case must keep baking and its tests must pass (it has no realistic T1, so it falls back to today's mask surface).
- Downloads (Task 3) go into a new empty directory under `/private/tmp/brain-look-spike/<source>/`, never into the repo. Run Python that reads them with `python -I`.
- MSD data: `/Users/kaydee/Developer/jarvis-neuro/.worktrees/plan-a/data/Task01_BrainTumour` (read only).

---

### Task 1: Fold-following brain surface (bake)

**Files:**
- Create: `backend/src/jarvis_neuro/cortex.py`, `backend/tests/test_cortex.py`
- Modify: `backend/src/jarvis_neuro/bake.py` (the `brain_surface` meshing line), `backend/tests/test_bake.py`
- Regenerate: `frontend/public/cases/brats_001|003|010/*/case.glb` (and `manifest.json` only if a stat legitimately changes)

**Produces:**

```python
# cortex.py
def cortex_mask(t1: np.ndarray, brain: np.ndarray, tumour: np.ndarray) -> np.ndarray | None
def cortex_surface(case: LoadedCase, brain: np.ndarray, seg: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None  # GL-space verts, faces, or None to fall back
```

Rules for `cortex_mask`:

1. Normalise T1 (`case.modalities["t1w"]`; if missing, return None) inside `brain` to its 2nd–98th percentile.
2. Threshold = Otsu (`skimage.filters.threshold_otsu`) on the normalised T1 inside `brain` eroded by 2 voxels (the erosion keeps the zero background out). Tissue = `brain & (t1n > threshold)`. CSF in the sulci is dark on T1, so it drops out and the folds open.
3. Union with `tumour` (`seg > 0`) dilated by 1 voxel, so the tumour never pokes through a hole in the cortex.
4. Keep the largest 26-connected component (`scipy.ndimage.label`), then 3D `binary_fill_holes`, so ventricles become solid and only the outer surface is meshed.
5. Return None if the result has fewer than 50 % of `brain`'s voxels (thresholding failed) — the caller falls back.

`cortex_surface`: `smooth_and_decimate(*mesh_from_mask(mask, A, sigma=0.6), BRAIN_TARGET_FACES, iterations=10)`. Keep `BRAIN_TARGET_FACES = 100_000` unless the folds disappear on decimation; if you raise it, stop at 200_000 and report the GLB size (it ships in a public repo; today's brats_001 `case.glb` is 2.8 MB).

In `bake_case`: `surf = cortex_surface(case, brain, seg)`; use it if not None, else today's mask surface. `min_dist_surface_mm` stays measured against `brain` (it is a distance to the envelope; do not change its meaning in this task).

- [ ] **Step 1: Failing tests** in `test_cortex.py`, on small synthetic volumes built in the test (no MSD data in CI):
  - a 40³ "brain" ball whose T1 is bright except for three radial slabs set dark (sulci): the cortex mask excludes the slab voxels near the surface and the mesh has more surface area than the ball's mesh (ratio > 1.05);
  - a dark tumour blob inside: it is in the mask;
  - a T1 that is constant (Otsu degenerate) or a case without `t1w`: returns None;
  - the largest-component rule drops a detached bright island.
  - In `test_bake.py`: the synthetic case still bakes and its `brain_surface` node exists (fallback path).
- [ ] **Step 2:** `cd backend && uv run pytest tests/test_cortex.py -q` → fail.
- [ ] **Step 3:** Implement `cortex.py` and the bake change.
- [ ] **Step 4:** `uv run pytest -q` → all pass.
- [ ] **Step 5: Rebake the real cases** with the same command the README / plan A used for them (read `backend/README.md` and `docs/superpowers/plans/2026-10-17-bake-pipeline.md` for it; ground-truth and monai-segresnet provenances for BRATS_001, BRATS_003, BRATS_010, with `--draco`). If the monai provenance needs the segmentation model and it is not available offline, rebake only ground-truth and report that. Then `git diff --stat frontend/public/cases` and check the manifests: only `case.glb` should change; report any manifest field that changed.
- [ ] **Step 6: Visual check without a browser:** render a PNG with trimesh/pyrender if installed, otherwise report the surface area and face count of old vs new `brain_surface` for brats_001 (area ratio > 1.2 expected if folds appeared) [the ratio is an estimate; report the number you get].
- [ ] **Step 7: Commit** `feat(bake): mesh the brain surface from T1 tissue so it follows the folds` (code + tests), then a second commit `chore(cases): rebake brats cases with the fold-following surface` (assets only).

### Task 2: Sulcal shading and translucent cortex material (frontend)

**Files:**
- Create: `frontend/src/scene/curvature.ts`, `frontend/src/scene/curvature.test.ts`
- Modify: `frontend/src/scene/materials.ts`, `frontend/src/scene/prepare.ts` (only: call `addSulcalColors(mesh.geometry)` once for the surface asset, before the right half is created, so both halves share it), `frontend/src/scene/scene.test.ts` (material expectations, if any break)

**Produces:**

```ts
// curvature.ts
/** Per-vertex concavity in [0, 1]: 1 = deepest sulcus, 0 = gyral crown. Pure, works on indexed and non-indexed geometry. */
export function concavity(positions: Float32Array, normals: Float32Array, index: ArrayLike<number> | null, smoothIters?: number): Float32Array
/** Writes a 'color' attribute (RGB float) mixing GYRUS_COLOR → SULCUS_COLOR by concavity. Idempotent. */
export function addSulcalColors(geometry: BufferGeometry): void
export const GYRUS_COLOR: string   // '#E8B4AE'
export const SULCUS_COLOR: string  // '#8E4A55'
```

Algorithm for `concavity` (umbrella operator, no library):

1. Build vertex adjacency from triangles. For non-indexed geometry, first weld vertices by position (round to 1e-5) so neighbours are shared.
2. For each vertex `i`: `d = mean(p_j for neighbours j) - p_i`; `c_i = dot(d, n_i) / meanEdgeLength_i`. Positive `c` means the neighbours sit "above" along the outward normal: the vertex is in a valley (sulcus).
3. Smooth `c` over the neighbours `smoothIters` times (default 3): `c_i = 0.5 * c_i + 0.5 * mean(c_j)`.
4. Map with robust percentiles: `lo = p5(c)`, `hi = p95(c)`, `out = clamp01((c - lo) / (hi - lo))`; if `hi <= lo` return all 0.5.
5. Then apply a large-scale term so deep sulci read darker than small dents: repeat steps 2–4 on a 12-iteration smoothed copy of the positions and take `0.6 * fine + 0.4 * coarse`. (This mimics a FreeSurfer "sulc" look without FreeSurfer, which we may not redistribute.)

Material changes in `materials.ts` (`asset.kind === 'surface'` only; tumours unchanged):

- `MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false, side: FrontSide })`. `color` white so vertex colours show as-is. Keep the default opacity 0.45 (the store and `[`/`]` keys own it).
- `RIM_COLOR` becomes a pale warm `'#FFE4DC'`, rim power 3.0, rim alpha boost 0.35 (from 0.5) so the edge glows softly instead of cyan.
- Add a slight sub-surface tint in the same `onBeforeCompile`: `outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.0, 0.86, 0.84), 0.25);` before the rim line.
- Remove `BRAIN_COLOR` if nothing else imports it; otherwise keep it pointing at `GYRUS_COLOR`.
- `customProgramCacheKey` stays unique (`'cortex-rim'`).
- Hover/selection emissive code paths stay as they are (they apply to tumours; the atlas plan will extend them to regions).

- [ ] **Step 1: Failing tests** `curvature.test.ts`:
  - a sphere (three `SphereGeometry(1, 48, 32)`): all values within 0.15 of each other (uniform curvature → no sulci) — check `max - min` of the raw (pre-percentile) `c`, export a `rawConcavity` helper for this;
  - a sphere with a groove (displace vertices with `|z| < 0.08` inward by 0.1): mean concavity of groove vertices > mean of the rest + 0.3;
  - non-indexed geometry (`toNonIndexed()`) gives the same groove result as indexed within 0.05;
  - `addSulcalColors` adds a `color` attribute of `count * 3` floats in [0, 1], and a second call does not change it;
  - `createAssetMaterial(surface)` has `vertexColors === true`, `transparent === true`, `depthWrite === false`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/scene/curvature.test.ts` → fail.
- [ ] **Step 3:** Implement. Performance budget: `concavity` on 100k faces under 150 ms in Node (log it once in a test with `performance.now()`, assert under 1000 ms so CI is not flaky).
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build` → green.
- [ ] **Step 5: Commit** `feat(scene): sulcal shading and a warm translucent cortex material`.

### Task 3: Atlas spike (report only, no commit)

Answer each with evidence (quoted licence text and its URL, command output). Do not commit downloads.

1. **SRI24** (https://www.nitrc.org/projects/sri24): exact licence text of the atlas package; whether it ships region label maps (LPBA40, `tzo116plus`, tissue maps) and under which licence; whether download needs a login.
2. **Harvard-Oxford**: the licence text that applies to the atlas files in the current FSL release (https://fsl.fmrib.ox.ac.uk/fsl/docs/license.html and the atlas's own XML/README). Is CC BY-SA 4.0 stated for the atlas data itself, or only for docs? Quote it.
3. **Alignment** (only if an SRI24 brain mask or T1 template is downloadable without login): load SRI24's brain mask and BRATS_001's brain mask (`(image != 0).any(-1)`, RAS-canonical via `nibabel.as_closest_canonical`), compare shapes and affines, resample if needed, and report Dice with no registration. Dice > 0.9 means SRI24-space labels can be applied to MSD cases directly; report the number either way.
4. **Recommendation** in 3 lines: which label source to use (prefer one natively in SRI24 space so no registration is needed), its licence obligations for this public repo, and what the atlas plan must build.

Report: ≤ 30 lines, each claim tagged `[VERIFIED: url or command]` or `[UNVERIFIED]`.

## Human check (not for the agent)

Open the viewer on brats_001: folds visible, sulci darker than gyri, tumours visible through the cortex at the default opacity; compare side by side with the BrainFacts brain. Tune `GYRUS_COLOR`, `SULCUS_COLOR`, the rim and the Otsu offset if needed.
