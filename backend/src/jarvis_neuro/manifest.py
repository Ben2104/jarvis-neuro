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
    kind: Literal["surface"]


class TumorAsset(_Strict):
    id: Literal["tumor_et", "tumor_ncr", "tumor_ed"]
    label: Literal[1, 2, 3]
    node: str
    kind: Literal["tumor"]
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

    @model_validator(mode="after")
    def _valid_assets(self):
        ids = [asset.id for asset in self.assets]
        if ids.count("brain_surface") != 1:
            raise ValueError("assets must contain exactly one brain_surface")
        if len(ids) != len(set(ids)):
            raise ValueError("asset ids must be unique")
        return self


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
