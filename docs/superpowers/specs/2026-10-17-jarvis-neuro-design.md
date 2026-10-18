# Jarvis-Neuro: Design

Cal Hacks 13.0. Gesture- and voice-controlled 3D brain tumor visualization for medical students.
**Educational visualization. Not for diagnosis or surgical planning.**

UI mockup: https://claude.ai/artifact/Dv2dBD77PWE6JrzWnantHv (private)

## 1. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Brain shown | The patient's own brain surface, extracted from the same scan as the tumor. No atlas, no registration. |
| 2 | Pipeline | Offline bake (P1). The bake produces meshes, a shipped intensity volume and a mask volume, and a manifest. There is no live inference at the demo. |
| 3 | Dataset | MSD Task01_BrainTumour (CC-BY-SA, derived from BraTS). Use 3–5 hand-picked cases. |
| 4 | Provenance | Each case is baked twice: once from the `ground-truth` labels and once from `monai-segresnet`. The UI shows which one is loaded. |
| 5 | Geometry authority | Every number in the UI or given to an LLM comes from `manifest.json`. LLMs never produce coordinates. |
| 6 | Agents | The Orchestrator is an LLM holding every UI tool. The Clinical Reasoner is an LLM sub-agent. The Spatial UI Dispatcher is a tool namespace. Vision is a deterministic tool. |
| 7 | Backend | FastAPI only (Python). It hosts the agent harness and serves the baked files. No Fastify. |
| 8 | Frontend | Vite + React + TypeScript + `@react-three/fiber` + drei. MediaPipe Hands for gestures. |

### Consequences of decision 1

The scan's own surface has no named structures. The following are therefore **out of scope**:

- Highlighting named regions (motor strip, Wernicke's area, lobes).
- Eloquent-area or functional-risk statements by the Clinical Reasoner. It answers "unknown, this requires atlas registration", using a scripted answer for judges.

"Hide a hemisphere" is a clipping plane at the estimated midsagittal plane, not a mesh split.

## 2. Data

- Source: MSD Task01_BrainTumour. It is 4D NIfTI with four modalities (FLAIR, T1w, T1gd, T2w). The labels are 1 edema, 2 non-enhancing tumor, 3 enhancing tumor.
- The volumes are skull-stripped, so the brain mask is `T1 > 0` after hole filling.
- Pick 3–5 demo cases covering both hemispheres and a range of sizes. Use only cases where MONAI's output looks clean.
- Attribute the dataset in the UI footer and the Devpost submission.

## 3. Bake pipeline (`bake/`, Python, offline)

One command: `python -m bake --cases cases.txt --out public/cases/`.

For each case:

1. Load the image and labels with nibabel and apply `nib.as_closest_canonical` so that voxel axes are RAS-aligned.
   After this, axial, coronal and sagittal slices are plain array indexing.
2. Segmentation:
   - `ground-truth`: use the dataset labels.
   - `monai-segresnet`: run the MONAI `brats_mri_segmentation` bundle with `sliding_window_inference`. The bundle
     outputs three overlapping sigmoid channels: TC, WT and ET. Convert them to exclusive labels:
     `ET = ET`, `NCR = TC − ET`, `ED = WT − TC`.
3. Brain surface: fill holes in `T1 > 0`, apply a Gaussian blur with σ ≈ 1 voxel, then run marching cubes at level 0.5.
4. Tumor surfaces: run marching cubes on `seg == L` for each label.
5. Run marching cubes in **voxel index space**. Do not pass `spacing=`, because the affine already carries the
   spacing and passing it would scale twice. Transform the vertices by `ras2gl · vox2ras`. If
   `det(vox2ras[:3,:3]) < 0`, reverse the triangle winding.
6. Smooth with Taubin (not Laplacian, which shrinks the mesh). Then apply quadric decimation: about 100k triangles
   for the brain surface and about 20k per tumor sub-region.
7. Write one Draco-compressed `case.glb`. Its nodes are `brain_surface`, `tumor_et`, `tumor_ncr` and `tumor_ed`.
   Vertices are in millimetres.
8. Compute statistics **from voxels**, not meshes: `volume_ml`, `centroid_ras`, `bbox_ras`, and
   `min_dist_surface_mm` (from the tumor voxels to the brain-mask boundary).
9. Estimate `midline_x_ras` as the x-centre of the brain mask's bounding box. Check it visually for each case.
10. If both provenances exist, compute Dice per sub-region of MONAI against ground truth and store it in
    `metrics`. Otherwise store `null`.
11. Write `flair_u8.bin` (FLAIR windowed to its 1st–99th percentile and quantised to uint8), `mask_u8.bin`
    (exclusive labels, uint8), `case.glb` and `manifest.json`.

Baked outputs are committed or uploaded as static files, so running the demo never requires MONAI, PyTorch or a GPU.

### RAS → glTF

glTF uses +Y up, +Z forward, and +X as the asset's left. Mapping `(x, y, z)_RAS → (−x, z, y)`:

```
ras2gl = [-1,0,0,0,
           0,0,1,0,
           0,1,0,0,
           0,0,0,1]   # det = +1, a pure rotation: winding is preserved
```

## 4. Manifest contract

```json
{
  "case_id": "msd_042",
  "provenance": "ground-truth",
  "dims": [240, 240, 155],
  "vox2ras": [16 numbers, row-major],
  "ras2gl": [-1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1],
  "midline_x_ras": 0.0,
  "volumes": { "flair": "flair_u8.bin", "mask": "mask_u8.bin" },
  "glb": "case.glb",
  "assets": [
    { "id": "brain_surface", "node": "brain_surface", "kind": "surface" },
    { "id": "tumor_et",  "label": 3, "node": "tumor_et",  "kind": "tumor", "color": "#E8705A",
      "volume_ml": 0, "centroid_ras": [0,0,0], "bbox_ras": [[0,0,0],[0,0,0]], "min_dist_surface_mm": 0 },
    { "id": "tumor_ncr", "label": 2, "node": "tumor_ncr", "kind": "tumor", "...": "same fields" },
    { "id": "tumor_ed",  "label": 1, "node": "tumor_ed",  "kind": "tumor", "...": "same fields" }
  ],
  "metrics": { "dice_vs_gt": null }
}
```

`label` holds the value written into `mask_u8.bin`, using the MSD label convention. `dims` is the canonical
(post-reorientation) shape. The two `.bin` files are C-order `[i][j][k]` and are served with `Content-Encoding: gzip`.

A JSON Schema for the manifest lives in `shared/manifest.schema.json`. The bake validates against it with pydantic,
and the frontend validates against it with zod.

## 5. Agents and tools

### Roles

| Role | Implementation | Model |
|---|---|---|
| Orchestrator | Strands agent. It holds every tool below except the Reasoner's internals. | `claude-haiku-5-5` |
| Clinical Reasoner | Strands sub-agent, invoked only through `explain`. Its input is the question plus the asset summary from the manifest. | `claude-sonnet-5-5` |
| Spatial UI Dispatcher | Tool namespace: the scene tools below, executed by the browser. | none |
| Vision | Deterministic tool `load_case`, which reads a manifest. | none |

Reasoner rules: it may state only facts derivable from the manifest (volumes, centroid, hemisphere relative to
`midline_x_ras`, distance to the surface, provenance, Dice if present). For anatomy, function or risk questions,
it answers that the question requires atlas registration, which this build does not do.

### Tools

```
load_case(case_id)                                  → summary of manifest assets
set_opacity(asset_id, value: 0..1)
focus_region(asset_id)                              camera fits asset bbox
set_cutaway(plane: axial|coronal|sagittal|none, ras_mm)
hide_hemisphere(side: left|right|none)              clip plane at midline_x_ras
toggle_visibility(asset_ids[], visible)
inspect_mri_slice(axis: axial|coronal|sagittal, index)
explain(question)                                   → Clinical Reasoner
```

Arguments are validated on the backend (pydantic) and the frontend (zod). Unknown `asset_id`s are rejected, and
numeric ranges are clamped. Validation errors go back to the LLM as tool results.

### Transport

- One WebSocket connects the browser and FastAPI. The backend forwards scene tool calls to the browser. The browser
  executes them and returns `{ok, result | error}`, which becomes the tool result.
- Speech-to-text uses the Web Speech API. In Chrome the audio goes to Google's servers, which is acceptable only
  because the data is public. Text-to-speech uses `speechSynthesis`.
- Gestures run entirely in the browser and never depend on the backend.

## 6. Frontend

- Load `case.glb` with GLTFLoader and DRACOLoader. Scale the root group by 0.001 (millimetres to scene units).
- Render order:
  - Tumor sub-regions are opaque and drawn first.
  - `brain_surface` is transparent at 0.45 opacity, with `depthWrite: false`, `side: FrontSide` and a Fresnel rim.
- Cutaway and hemisphere hiding use per-material clipping planes with `localClippingEnabled`.
- 2D MRI panel:
  - A 2D canvas reads slices straight from the `Uint8Array` volumes.
  - The mask outline is drawn where a voxel's label differs from its neighbour's.
  - The crosshair and the 3D marker are linked through `vox2ras` and its inverse.
- Every tool has a keyboard shortcut as the demo fallback.

### Gestures

Start from the docx hook (EMA smoothing plus pinch hysteresis), with these fixes:

1. Keep pinch state in a `useRef`, not React state. The docx version reads stale state inside the per-frame
   callback, so the hysteresis compares against an old value.
2. Fire selection on the pinch **rising edge** only. The docx version dispatches every frame while pinched.
3. Raycast against tumor assets first, or exclude `brain_surface`. Otherwise the translucent brain absorbs every
   ray and the tumor can never be picked.
4. Clone materials per asset before changing hover emissive. Otherwise shared materials make every mesh glow.

Mapping: open hand = rotate, pinch = select, two hands = zoom.

### UI

Follow the mockup linked at the top. Known fixes before building:

- The hover label "Pinch = select · Motor strip" contradicts decision 1. Use asset names (`tumor_et`,
  `brain_surface`).
- Mockup volumes such as 12.4 mL are placeholders. The built UI shows only manifest values.

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Manifest or asset fetch fails, or the schema is invalid | Error banner. The previous case stays loaded. |
| A tool call fails validation or execution | The error is returned to the Orchestrator, which tells the user it could not do that. |
| WebSocket drops | Reconnect with backoff. Gestures and keyboard shortcuts keep working. |
| Speech-to-text unavailable or noisy | Text input box plus keyboard shortcuts. |
| Webcam denied | Mouse and keyboard control. |

## 8. Testing

Bake (pytest). These tests carry the alignment claim:

- A synthetic sphere baked under a known non-identity affine, including one with `det < 0`: `centroid_ras`
  matches the analytic value within 0.5 voxel, and mesh normals point outward.
- Mesh volume is within 5% of voxel volume.
- For every case, the tumor centroid lies inside the brain mask.
- The exclusive labels ET, NCR and ED do not overlap, and their union equals WT.
- Every written manifest validates against the schema.

Frontend (vitest):

- The RAS → voxel → RAS round trip is exact to 1e-6.
- The slice through `centroid_ras` contains a mask label > 0.
- Tool schemas reject unknown asset IDs and clamp out-of-range values.
- The gesture hook's pinch hysteresis does not flicker on a jittery distance sequence, and selection fires once per
  pinch.

## 9. Verify before relying on

- The MONAI bundle's input channel order against MSD's modality order. A mismatch silently produces wrong masks.
- The MONAI bundle's output channel semantics (TC, WT, ET) against its `inference.json`/metadata.
- Whether `nib.as_closest_canonical` output for MSD needs any further flip to match the expected slice orientation
  in the 2D panel.
- The gzipped sizes of `flair_u8.bin` and `mask_u8.bin`. The raw size is 8.93 MB each at 240×240×155.
- The latency of one Orchestrator turn with tool calls, measured on the venue network.

## 10. Out of scope

Live inference at the demo; atlas registration and named anatomy; DICOM; raw BraTS redistribution; any diagnostic,
risk or surgical-planning output.
