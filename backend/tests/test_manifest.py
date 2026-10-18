import json

import numpy as np
import pytest
from pydantic import ValidationError

from jarvis_neuro.geometry import RAS2GL
from jarvis_neuro.manifest import (
    SCHEMA_PATH, Manifest, Metrics, SurfaceAsset, TumorAsset, Volumes, update_index,
)


def et_asset(**over):
    base = dict(id="tumor_et", label=3, node="tumor_et", kind="tumor", color="#E8705A", volume_ml=1.2,
                centroid_ras=(1.0, 2.0, 3.0), bbox_ras=((0.0, 0.0, 0.0), (2.0, 2.0, 2.0)), min_dist_surface_mm=4.0)
    base.update(over)
    return TumorAsset(**base)


def sample(**over):
    base = dict(
        case_id="synth_001", provenance="synthetic", dims=(4, 5, 6),
        vox2ras=np.eye(4).ravel().tolist(), ras2gl=RAS2GL.ravel().tolist(), midline_x_ras=0.0,
        volumes=Volumes(flair="flair_u8.bin", mask="mask_u8.bin"), glb="case.glb",
        assets=[SurfaceAsset(id="brain_surface", node="brain_surface", kind="surface"), et_asset()], metrics=Metrics(),
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


@pytest.mark.parametrize("asset_type", ["SurfaceAsset", "TumorAsset"])
def test_schema_requires_asset_kind(asset_type):
    schema = Manifest.model_json_schema()
    assert "kind" in schema["$defs"][asset_type]["required"]


@pytest.mark.parametrize("asset_index,model", [(0, SurfaceAsset), (1, TumorAsset)])
def test_asset_constructors_require_kind(asset_index, model):
    payload = sample().assets[asset_index].model_dump()
    payload.pop("kind")
    with pytest.raises(ValidationError, match="kind"):
        model.model_validate(payload)


@pytest.mark.parametrize("brain_count", [0, 2])
def test_manifest_requires_exactly_one_brain_surface(brain_count):
    brain = SurfaceAsset(id="brain_surface", node="brain_surface", kind="surface")
    with pytest.raises(ValidationError, match="exactly one brain_surface"):
        sample(assets=[brain] * brain_count + [et_asset()])


def test_manifest_rejects_duplicate_asset_ids():
    assets = sample().assets
    with pytest.raises(ValidationError, match="unique"):
        sample(assets=assets + [et_asset()])


def test_index_upserts_by_case_and_provenance(tmp_path):
    update_index(tmp_path, sample(), "synth_001/synthetic/manifest.json")
    update_index(tmp_path, sample(), "synth_001/synthetic/manifest.json")
    idx = update_index(tmp_path, sample(provenance="monai-segresnet"), "synth_001/monai-segresnet/manifest.json")
    assert [(e.case_id, e.provenance) for e in idx.cases] == [
        ("synth_001", "monai-segresnet"), ("synth_001", "synthetic")]
