"""Read the baked case index and manifests from disk (spec decision 5: every number comes from manifest.json)."""
import os
from pathlib import Path
from typing import Any

from ..manifest import CaseIndex, IndexEntry, Manifest, TumorAsset

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CASES_DIR = REPO_ROOT / "frontend" / "public" / "cases"


def cases_dir() -> Path:
    return Path(os.environ.get("CASES_DIR", DEFAULT_CASES_DIR))


def hemisphere_of(x: float, midline_x: float) -> str:
    """RAS +x is patient right. Same rule as the viewer's hemisphereOf."""
    if x < midline_x:
        return "left"
    if x > midline_x:
        return "right"
    return "midline"


class CaseRepo:
    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root is not None else cases_dir()

    def index(self) -> CaseIndex:
        return CaseIndex.model_validate_json((self.root / "index.json").read_text())

    def entry(self, case_id: str, provenance: str | None = None) -> IndexEntry:
        """The index entry the viewer would load: the first match in index order."""
        cases = self.index().cases
        same_id = [e for e in cases if e.case_id == case_id]
        if not same_id:
            known = sorted({e.case_id for e in cases})
            raise ValueError(f"unknown case_id {case_id!r}; expected one of {', '.join(known)}")
        match = [e for e in same_id if provenance is None or e.provenance == provenance]
        if not match:
            available = ", ".join(e.provenance for e in same_id)
            raise ValueError(f"no case {case_id} with provenance {provenance}; available: {available}")
        return match[0]

    def manifest(self, entry: IndexEntry) -> Manifest:
        return Manifest.model_validate_json((self.root / entry.path).read_text())


def case_summary(m: Manifest) -> dict[str, Any]:
    """What load_case returns to the Orchestrator. Mirrors the viewer's caseSummary."""
    assets: list[dict[str, Any]] = []
    for a in m.assets:
        if isinstance(a, TumorAsset):
            assets.append(
                {
                    "id": a.id,
                    "kind": a.kind,
                    "label": a.label,
                    "volume_ml": a.volume_ml,
                    "centroid_ras": list(a.centroid_ras),
                    "bbox_ras": [list(a.bbox_ras[0]), list(a.bbox_ras[1])],
                    "min_dist_surface_mm": a.min_dist_surface_mm,
                    "hemisphere": hemisphere_of(a.centroid_ras[0], m.midline_x_ras),
                }
            )
        else:
            assets.append({"id": a.id, "kind": a.kind})
    return {
        "case_id": m.case_id,
        "provenance": m.provenance,
        "dims": list(m.dims),
        "midline_x_ras": m.midline_x_ras,
        "assets": assets,
        "dice_vs_gt": m.metrics.dice_vs_gt,
    }
