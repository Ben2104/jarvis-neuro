# jarvis-neuro viewer

Browser viewer for baked cases (`public/cases/<case_id>/<provenance>/`). It shows the patient's brain surface and tumour sub-regions in 3D, linked to a 2D MRI slice panel, and drives everything through one tool executor that the keyboard, webcam gestures and (later) the agent all call.

Educational visualization — not for diagnosis or surgical planning.

## Run

Node 22.

```bash
npm ci
npm run dev        # http://localhost:5173/
npm test           # vitest, Node only, uses the committed synth_001 case
npm run typecheck
npm run build      # dist/
```

`npm run dev` and `npm run build` first run `scripts/vendor.mjs`. It copies the Draco decoder and the MediaPipe wasm into `public/` and downloads the hand model (`public/mediapipe/hand_landmarker.task`) once. All three are gitignored. Without network access the model download is skipped: the viewer still runs and gesture mode reports `Webcam unavailable`.

Cases come from the bake pipeline (`../backend`, Plan A). The viewer reads `public/cases/index.json` and, per case, `manifest.json`, `case.glb`, `flair_u8.bin` and `mask_u8.bin`. The manifest schema lives in `../shared/manifest.schema.json`, and `src/lib/manifest.ts` mirrors it with zod. Change both together.

## Controls

| Input | Action |
|---|---|
| Mouse drag / scroll | rotate / zoom |
| Click a tumour sub-region | select it; the MRI crosshair moves to its centroid |
| Click the MRI slice | place the marker there |
| `1` `2` `3` | axial / coronal / sagittal slice through the marker |
| `↑` `↓` | next / previous slice |
| `[` `]` | brain surface opacity −0.1 / +0.1 |
| `c` | cutaway: off → axial → coronal → sagittal → off |
| `h` | hide hemisphere: none → left → right → none |
| `e` | explode view: 0 → 50% → 100% → 0 |
| `f` | focus the selected sub-region (the first tumour sub-region if none is selected) |
| `b` / `t` | toggle brain surface / all tumour sub-regions |
| `n` | next case in the index |
| `g` | webcam gesture mode on/off |

Gesture mode: the camera shows mirrored and dimmed behind the 3D view, so you can watch your hand touch the brain. An open hand rotates, a pinch selects what is under the reticle, and two hands moving apart or together zoom. Holding a pinch and moving it up pulls the hemispheres and tumour sub-regions apart (down closes them again). If the camera is denied or missing, the header says so and mouse and keyboard keep working.
Open your hand before pinching: a pinch only selects after the hand has been seen open, so a tracking dropout mid-pinch cannot select twice.

## Layout of `src/`

- `lib/`: pure, tested code. The manifest schema, affine math (`vox2ras`, its inverse, `ras2gl`), volume slicing, slice rendering and case loading.
- `state/store.ts`: the single zustand store with all view state.
- `tools/`: zod tool schemas, `executeTool`, and the keyboard shortcut mapping.
- `scene/`: three / react-three-fiber. Per-asset materials, clipping planes, picking (never the brain surface) and camera.
- `gestures/`: the event bus, the pure pinch reducer (`pinch.ts`) and the webcam hook.
- `ui/`: panels and formatting. Every number shown comes from `manifest.json`. Missing values render as `—`.

## Agent hook

`executeTool(store, { id, name, args }, source)` in `src/tools/execute.ts` is the only way the scene changes on request. It validates `args` with zod, rejects unknown asset ids and keys, clamps numeric ranges, logs the call in the Agent console and returns `{ id, ok: true, result }` or `{ id, ok: false, error }`. The Plan C WebSocket client calls it. Dev builds expose it in the console:

```js
await __jarvis.executeTool(__jarvis.store, { id: 'x', name: 'focus_region', args: { asset_id: 'tumor_et' } })
```

Tools: `load_case`, `set_opacity`, `focus_region`, `set_cutaway`, `hide_hemisphere`, `set_explode`, `toggle_visibility`, `inspect_mri_slice`.

## Known limits

- `focus_region` on a tumour sub-region also selects it, which moves the marker and the MRI slice to its centroid.
- The 2D slice orientation (radiological: patient right on screen left) is verified on the synthetic case only. Re-check it on a real MSD case (spec §9). It is set in one place: `slicePixelToVoxel` / `voxelToSlicePixel` in `src/lib/volume.ts`.
- The opacity and cutaway sliders write the store directly and do not appear in the Agent console. Their keyboard and agent equivalents do.

Dataset: Medical Segmentation Decathlon, Task01_BrainTumour (derived from BraTS), CC BY-SA 4.0.
