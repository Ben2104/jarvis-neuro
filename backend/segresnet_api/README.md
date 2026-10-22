# segresnet-api

FastAPI service that segments BraTS tumors (MONAI SegResNet) from 4 MRI sequences (t1c, t1, t2, flair) and returns `report.json`, `model.glb` and `seg.nii.gz`.

## Weights

`weights/model.pt` is not in git. Get it from brain3d:

```sh
mkdir -p weights
git -C /Users/kaydee/Developer/brain3d show origin/Tomlocal:SegResNet_api/weights/model.pt > weights/model.pt
```

or copy `models/model.pt` from the MONAI `brats_mri_segmentation` bundle.

## Run

```sh
uv sync
uv run uvicorn src.api:app --port 8001     # :8000 belongs to the jarvis-neuro agent server
# or
docker compose up --build                  # host :8001 -> container :8000, weights/ mounted read-only
```

`ALLOWED_ORIGINS` (comma-separated) sets CORS; default `http://localhost:5173`.
