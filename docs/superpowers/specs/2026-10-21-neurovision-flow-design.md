# NeuroVision Flow: Design

Restructures the viewer to the NeuroVision Figma flow and links live SegResNet segmentation into it.
Builds on `2026-10-17-jarvis-neuro-design.md`; everything there still holds unless this spec overrides it.
**Educational visualization. Not for diagnosis or surgical planning.**

Figma: https://www.figma.com/design/rHjTVYYISZzHWvWNeSKaVE/NeuroVision?node-id=43-2
Frames: `43:3` 01 Upload, `44:99` 02 Processing, `43:767` 03 MRI Workspace + Agent, `43:1149` 04 Tumor in 3D.

Branch: `feat/segresnet-api` (worktree `.worktrees/segresnet`).

## 1. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Upload input | Four NIfTI sequences: `t1c`, `t1`, `t2`, `flair` (`.nii` / `.nii.gz`). SegResNet needs all four; a single T1CE file is not accepted. DICOM, ZIP and 2D-slice cards are shown disabled ("not in this build"). |
| 2 | Clinical fields | Only values computed from the scan are shown. Figma slots that need an atlas or a classifier (lobe names, hippocampus margin, tumour type, confidence %, eloquent cortex) render "Requires atlas — not in this build". Decision 1 of the base spec (no atlas) stands. |
| 3 | Integration | The agent server (`:8000`) owns uploads. It forwards the four files to SegResNet (`:8001`), pulls `seg.nii.gz`, and bakes a normal viewer case with the existing `bake_case`. The viewer and `load_case` load it like any baked case. |
| 4 | UI scope | The four Figma screens only. Header tabs Explore, Learning Mode and Help render disabled. |
| 5 | Docker | Root `compose.yaml` runs the full stack: `segresnet` + `app` (agent server serving the built frontend). |
| 6 | Agents | Orchestrator and Clinical Reasoner are live (existing). Vision and Spatial UI chips are placeholders (greyed, no behaviour). |

## 2. Architecture and data flow

```
Browser (vite :5173 in dev | served by app in docker)
  POST /api/studies         multipart t1c, t1, t2, flair
  GET  /api/studies/{id}    polled every 1 s
  /ws                       existing agent socket, unchanged
        │
Agent server :8000  (jarvis_neuro.agent)
  studies.py
   step read     save files, nibabel-load each, check same shape and same affine (atol 1e-3)
   step volume   stack to 4D in MSD order [FLAIR, T1, T1gd, T2] -> LoadedCase; report dims + spacing
   step segment  POST the four files to SEGRESNET_URL/jobs, poll GET /jobs/{id} every 2 s
   step measure  GET /jobs/{id}/seg.nii.gz, remap labels, bake_case(..., provenance="monai-segresnet",
                 draco=False) into CASES_DIR/<study_id>/monai-segresnet/, update_index()
   done          {case_id: <study_id>}
        │
SegResNet :8001  (backend/segresnet_api, unchanged)
```

### Label remap

SegResNet writes BraTS labels (`pipeline.py:save_label_map`): 0 background, 1 tumour core (NCR), 2 edema, 4 enhancing.
The viewer and manifest use MSD labels: 1 ED, 2 NCR, 3 ET.

| BraTS | MSD |
|---|---|
| 0 | 0 |
| 1 | 2 |
| 2 | 1 |
| 4 | 3 |

Any other value fails the study with `unexpected label <n> in seg.nii.gz`.

### Study API

`POST /api/studies` — multipart fields `t1c`, `t1`, `t2`, `flair`. Total upload ≤ 250 MB (SegResNet's own cap is
200 MB per file). Returns `202 {"study_id": "<12 hex>"}`. Errors: `400 {"detail": "<field>: <reason>"}` for a
missing field, wrong extension, unreadable NIfTI, or shape/affine mismatch; `413` over the size cap.

`GET /api/studies/{id}` — `404` for an unknown id, else:

```json
{
  "study_id": "a1b2c3d4e5f6",
  "status": "running",
  "step": "segment",
  "steps": {
    "read":    {"state": "done", "seconds": 0.4},
    "volume":  {"state": "done", "dims": [240, 240, 155], "spacing_mm": [1.0, 1.0, 1.0]},
    "segment": {"state": "running"},
    "measure": {"state": "pending"}
  },
  "case_id": null,
  "error": null
}
```

`status` ∈ `queued | running | done | failed`. `step` ∈ `read | volume | segment | measure`. Each step's `state` ∈
`pending | running | done | failed`. On `done`, `case_id` equals `study_id`. On `failed`, `error` is one line and the
failed step has `state: "failed"`.

The study table is in memory. `shortcut: lost on restart, upgrade to disk if the server runs more than one process.`
One worker thread runs studies one at a time.

Segmentation progress is **indeterminate**: SegResNet reports no percentage, so the UI shows no number.

### Errors

| Failure | Behaviour |
|---|---|
| Validation fails | 400 with a reason; the Upload screen shows it inline and stays on Upload. |
| SegResNet unreachable | Study fails at `segment`: `segmentation service unreachable at <SEGRESNET_URL>`. |
| SegResNet job `failed` | Study fails at `segment` with SegResNet's error text. |
| No tumour (`has_tumor: false`) | The case still bakes. The brain renders; the analysis panel says "No tumor detected". |
| Bake fails | Study fails at `measure` with the exception message. |

## 3. Frontend

A `stage` field in the existing zustand `viewerStore`: `upload | processing | workspace | explore3d`. No router.
The header's "MRI Workspace" tab returns to `workspace` once a case is loaded.

| Screen | Components | Notes |
|---|---|---|
| Shared | `Header`, `Footer` (restyled) | Explore / Learning Mode / Help disabled. Webcam and Sensitivity chips kept. |
| 01 Upload | `UploadScreen` (new) | Drop zone and "Browse files" accept several files; a filename matcher assigns them to the four slots. Four manual slots as fallback. "Use sample" loads `brats_001` and goes to `workspace`. Privacy card kept: volumes never leave the machine; the LLM sees manifest facts only. |
| 02 Processing | `ProcessingScreen` (new) | Polls the study. Rows: Read file · Build 3D volume (dims, spacing) · Segment tumor (SegResNet, indeterminate bar) · Measure volume & location. Cancel returns to Upload (the backend study keeps running; result ignored). "Open MRI Workspace" enabled on `done`, which calls the existing case load with `case_id`. |
| 03 Workspace | `MriPanel` ×3, `DatasetCard` (new), `AgentConsole`, `FindingsPanel` | MPR: axial large, sagittal and coronal small. Left: dataset card (case id, dims, spacing, provenance) and agent console with agent chips. Right: "Volumetric Analysis" from the manifest; atlas-only fields per decision 2. "Place tumor in 3D" → `explore3d`. |
| 04 3D | `ViewportPanel`, `SceneControls`, `GestureCursor`, `WebcamBackdrop`, `AgentConsole` | Existing scene and tools. Left: pathology summary and HUD toggles (opacity, focus tumor, hide healthy). Right: webcam telemetry, explode slider, agent. Structures bar lists the manifest's tumour assets only. |

### Filename matcher

Case-insensitive, on the basename. Checked in this order so `t1` never takes a contrast file:

1. `t1c`: `t1c`, `t1ce`, `t1gd`, `t1_gd`, `t1-gd`, `t1post`
2. `flair`: `flair`
3. `t2`: `t2` (and not `flair`)
4. `t1`: `t1` not followed by `c`, `ce`, `gd`, `_gd`, `-gd`, `post`

A file matching no slot, or two files for one slot, leaves the slot for manual choice.

### MPR state

`slice: {axis, index}` becomes `slices: Record<Axis, number>` plus `activeAxis: Axis`. `inspect_mri_slice(axis, index)`
sets `slices[axis] = index` and `activeAxis = axis`. Loading a case centres all three on the largest tumour's centroid
(as `slice` does today for one axis). `MriPanel` takes an `axis` prop. Crosshairs use the existing `marker`.

### Design tokens

Colours, type scale and radii come from the Figma file's variables (`get_variable_defs`) into `theme.css`.

### Not built

Bone / Subdural / Perfusion window presets, Electronic Caliper, Contrast / Gamma, Export NIfTI mask, Adjust Threshold,
the Script tab (`case_tour.neuro`), the History tab, the volume trend ("+1.2 cm³ (60d)"), Dice on uploaded studies (no
ground truth), and anatomy chips (Cerebral Cortex, Ventricles, Thalamus, Cerebellum).

## 4. Docker and local run

### Files

- `backend/Dockerfile` — build context is the repo root. Stage 1 `node:22-slim`: `npm ci && npm run build` in
  `frontend/`. Stage 2 `python:3.12-slim` + uv: `uv sync --frozen --no-dev` for `backend/`, copy `frontend/dist`,
  `CMD uvicorn jarvis_neuro.agent.app:app --host 0.0.0.0 --port 8000`.
- `compose.yaml` (repo root):
  - `segresnet`: build `backend/segresnet_api`; `./backend/segresnet_api/weights:/app/weights:ro`; jobs volume;
    host port 8001; healthcheck `/health`.
  - `app`: build `.` with `backend/Dockerfile`; host port **8080**→8000 (so native uvicorn on 8000 can run alongside);
    `SEGRESNET_URL=http://segresnet:8000`; `CASES_DIR` = the cases dir inside the served `dist`; a named volume on that
    dir (seeded with the sample cases on first run); `env_file: .env`; `depends_on: segresnet: service_healthy`.
- `.env.example` (`MODEL_PROVIDER`, model ids, API keys). `.env` is gitignored.
- `.gitignore`: uploaded study cases under `frontend/public/cases/` (sample cases stay tracked).

`SEGRESNET_URL` defaults to `http://localhost:8001`.

### Runner tab (three panes)

| Pane | Command | Port |
|---|---|---|
| frontend | `cd frontend && npm run dev` | 5173, proxies `/api` and `/ws` to 8000 |
| backend | `cd backend && uv run uvicorn jarvis_neuro.agent.app:app --port 8000 --reload` | 8000 |
| docker | dev: `docker compose up --build segresnet`; full test: `docker compose up --build` | 8001; 8080 |

In dev, studies bake into `frontend/public/cases/<id>/` (default `CASES_DIR`) and vite serves them.

### Prerequisites

- Docker Desktop running.
- `backend/segresnet_api/weights/model.pt` (see `backend/segresnet_api/README.md`).

## 5. Work split

Three agent panes share this worktree. Each pane commits only its own paths with an explicit pathspec
(`git commit -- <paths>`), never `git add -A`. QA does not edit product code; it reports to the owning pane.

| Pane | Owns | Work |
|---|---|---|
| backend | `backend/` except `backend/segresnet_api/src`, `compose.yaml`, `.env.example`, `.gitignore` | Study API, label remap, SegResNet client (`httpx` moves to runtime deps), Dockerfile, compose. |
| frontend | `frontend/` | Tokens, stage machine, Upload, Processing, MPR, Workspace, 3D layout. Develops against a mocked `/api/studies` through the store's injected `fetchFn`. |
| QA | `scripts/qa/` | GitNexus impact on `slice` before the MPR change; `pytest`, `vitest`, `tsc` after each commit; compose end-to-end; browser screenshots of all four screens; inference time and memory; the user's MRI study. |

## 6. Testing

Backend (pytest, no torch, SegResNet client faked):

- Label remap maps {0,1,2,4} → {0,2,1,3}; any other label raises.
- Uploads with mismatched shapes or affines return 400 naming the field.
- Route flow: POST → steps advance → `done` with `case_id`; SegResNet failure → `failed` at `segment`.
- A synthetic case through the adapter writes a manifest that validates against `shared/manifest.schema.json`, and
  `mask_u8.bin` holds only {0,1,2,3}.

Frontend (vitest):

- Filename matcher: `t1` never takes `t1c` / `t1ce` / `t1gd`; `t2` never takes `flair`; duplicates leave the slot open.
- Store: stage transitions; `inspect_mri_slice` sets `slices[axis]` and `activeAxis`; existing slice tests updated.
- Processing screen maps each study status to the right row states.

End to end (QA, compose on :8080): health → upload → poll to `done` → case loads → screenshots of the four screens.

## 7. Open items

- No raw MSD volumes are on disk, so there is no four-file fixture yet. The first end-to-end run uses the user's MRI
  study.
- SegResNet CPU time and memory at 240×240×155 inside Docker are unmeasured; QA reports them.
- How `create_app` resolves `static_dir` inside the container is pinned in the plan.
