"""Bake one case: meshes + uint8 volumes + manifest. CLI: python -m jarvis_neuro.bake {synthetic,msd,survey}."""
import argparse
import tempfile
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_fill_holes

from .cortex import cortex_surface
from .geometry import RAS2GL, mesh_from_mask
from .glb import draco_compress, write_glb
from .io_msd import LoadedCase, load_msd_case
from .labels import ASSET_BY_LABEL, COLOR_BY_LABEL, TUMOR_LABELS
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
    written_seg = seg.copy()

    surf = cortex_surface(case, brain, seg)
    v, f = surf if surf is not None else smooth_and_decimate(
        *mesh_from_mask(brain, A, sigma=1.0), BRAIN_TARGET_FACES
    )
    nodes = [("brain_surface", v, f)]
    assets: list = [SurfaceAsset(id="brain_surface", node="brain_surface", kind="surface")]
    for label in TUMOR_LABELS:
        m = seg == label
        if not m.any():
            continue
        v, f = smooth_and_decimate(*mesh_from_mask(m, A, sigma=0.5), TUMOR_TARGET_FACES)
        if len(f) == 0:
            written_seg[m] = 0
            continue
        name = ASSET_BY_LABEL[label]
        nodes.append((name, v, f))
        lo, hi = bbox_ras(m, A)
        assets.append(TumorAsset(
            id=name, label=label, node=name, kind="tumor", color=COLOR_BY_LABEL[label],
            volume_ml=volume_ml(m, A), centroid_ras=_vec(centroid_ras(m, A)), bbox_ras=(_vec(lo), _vec(hi)),
            min_dist_surface_mm=min_dist_surface_mm(m, brain, A),
        ))

    write_glb(nodes, out_dir / "case.glb")
    if draco:
        draco_compress(out_dir / "case.glb")
    write_bin(window_to_u8(case.image[..., case.modalities["flair"]], brain), out_dir / "flair_u8.bin")
    write_bin(written_seg, out_dir / "mask_u8.bin")

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
    """One line per case: whole-tumor mL and side relative to the brain-bbox midline."""
    print("case\twt_ml\tside")
    for p in sorted((root / "labelsTr").glob("*.nii.gz")):
        if p.name.startswith("._"):
            continue
        case = load_msd_case(root, p.name.removesuffix(".nii.gz"))
        wt = case.labels > 0
        if not wt.any():
            continue
        A = case.vox2ras
        cx = centroid_ras(wt, A)[0]
        brain = (case.image != 0).any(-1)
        mid = midline_x_ras(brain, A)
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
