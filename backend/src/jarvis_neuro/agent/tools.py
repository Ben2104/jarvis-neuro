"""The Orchestrator's tools (spec §5). Scene tools are validated here, then executed by the browser."""
from dataclasses import dataclass
from typing import Any, Literal

from strands import tool

from ..manifest import Manifest
from .bridge import BrowserBridge
from .cases import CaseRepo, case_summary
from .reasoner import Explainer
from .scene_args import check_asset_ids, clamp, clamp_cut_mm, clamp_slice_index

LOAD_TIMEOUT_S = 30.0

Provenance = Literal["ground-truth", "monai-segresnet", "synthetic"]
Plane = Literal["axial", "coronal", "sagittal", "none"]
Side = Literal["left", "right", "none"]
Axis = Literal["axial", "coronal", "sagittal"]


@dataclass
class SceneContext:
    """Per-connection state the tools share. `manifest` is the case the browser shows."""

    bridge: BrowserBridge
    repo: CaseRepo
    manifest: Manifest | None = None

    def require_case(self) -> Manifest:
        if self.manifest is None:
            raise ValueError("no case loaded; call load_case first")
        return self.manifest

    def set_case(self, case_id: str, provenance: str | None) -> Manifest:
        self.manifest = self.repo.manifest(self.repo.entry(case_id, provenance))
        return self.manifest


def make_tools(ctx: SceneContext, explainer: Explainer) -> list[Any]:
    @tool
    async def load_case(case_id: str, provenance: Provenance | None = None) -> dict:
        """Load a baked case into the viewer and return its manifest summary.

        Args:
            case_id: Case id from the case index, for example brats_001.
            provenance: ground-truth (expert labels) or monai-segresnet (model output). Omit for the default.
        """
        entry = ctx.repo.entry(case_id, provenance)
        manifest = ctx.repo.manifest(entry)
        args = {"case_id": entry.case_id, "provenance": entry.provenance}
        await ctx.bridge.call("load_case", args, timeout_s=LOAD_TIMEOUT_S)
        ctx.manifest = manifest
        return case_summary(manifest)

    @tool
    async def set_opacity(asset_id: str, value: float) -> Any:
        """Set one asset's opacity.

        Args:
            asset_id: An asset id from load_case, for example brain_surface or tumor_et.
            value: Opacity from 0 (invisible) to 1 (opaque). Out-of-range values are clamped.
        """
        check_asset_ids(ctx.require_case(), [asset_id])
        return await ctx.bridge.call("set_opacity", {"asset_id": asset_id, "value": clamp(value, 0, 1)})

    @tool
    async def focus_region(asset_id: str) -> Any:
        """Fit the camera to an asset's bounding box. Selecting a tumour sub-region also moves the MRI slice to it.

        Args:
            asset_id: An asset id from load_case.
        """
        check_asset_ids(ctx.require_case(), [asset_id])
        return await ctx.bridge.call("focus_region", {"asset_id": asset_id})

    @tool
    async def set_cutaway(plane: Plane, ras_mm: float | None = None) -> Any:
        """Cut every asset with a plane. Use plane none to remove the cut.

        Args:
            plane: axial, coronal, sagittal or none.
            ras_mm: Plane position in RAS millimetres. Required unless plane is none. Copy it from a
                centroid_ras or bbox_ras value in the load_case result; never invent it.
        """
        m = ctx.require_case()
        if plane == "none":
            return await ctx.bridge.call("set_cutaway", {"plane": "none"})
        if ras_mm is None:
            raise ValueError("ras_mm is required unless plane is none")
        return await ctx.bridge.call("set_cutaway", {"plane": plane, "ras_mm": clamp_cut_mm(m, plane, ras_mm)})

    @tool
    async def hide_hemisphere(side: Side) -> Any:
        """Hide one half of brain_surface, split at the case midline. Use none to show both.

        Args:
            side: left, right or none (patient left and right).
        """
        ctx.require_case()
        return await ctx.bridge.call("hide_hemisphere", {"side": side})

    @tool
    async def set_explode(value: float) -> Any:
        """Pull the brain apart: the hemispheres and tumour sub-regions move away from each other.

        Args:
            value: 0 (assembled) to 1 (fully apart). Out-of-range values are clamped.
        """
        ctx.require_case()
        return await ctx.bridge.call("set_explode", {"value": clamp(value, 0, 1)})

    @tool
    async def toggle_visibility(asset_ids: list[str], visible: bool) -> Any:
        """Show or hide assets.

        Args:
            asset_ids: One or more asset ids from load_case.
            visible: true to show, false to hide.
        """
        check_asset_ids(ctx.require_case(), asset_ids)
        return await ctx.bridge.call("toggle_visibility", {"asset_ids": asset_ids, "visible": visible})

    @tool
    async def inspect_mri_slice(axis: Axis, index: int) -> Any:
        """Show one MRI slice in the 2D panel and list the mask labels present in it.

        Args:
            axis: axial, coronal or sagittal.
            index: Slice index along that axis. Out-of-range values are clamped to the volume.
        """
        m = ctx.require_case()
        return await ctx.bridge.call("inspect_mri_slice", {"axis": axis, "index": clamp_slice_index(m, axis, index)})

    @tool
    async def explain(question: str) -> str:
        """Answer a question about the loaded case with the Clinical Reasoner. It uses manifest facts only.

        Args:
            question: The user's question, in their words.
        """
        return await explainer(question, ctx.require_case())

    return [
        load_case,
        set_opacity,
        focus_region,
        set_cutaway,
        hide_hemisphere,
        set_explode,
        toggle_visibility,
        inspect_mri_slice,
        explain,
    ]
