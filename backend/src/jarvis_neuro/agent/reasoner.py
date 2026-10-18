"""The Clinical Reasoner: a Strands sub-agent reached only through `explain` (spec §5 Roles)."""
import json
from collections.abc import Awaitable, Callable
from typing import Any

from strands import Agent
from strands.models.model import Model

from ..manifest import Manifest, TumorAsset
from .cases import hemisphere_of

Explainer = Callable[[str, Manifest], Awaitable[str]]

# The scripted answer for anatomy, function and risk questions (spec §1, consequences of decision 1).
ATLAS_ANSWER = (
    "Unknown. That needs atlas registration, which this build does not do: "
    "the surface shown is this patient's own scan and has no named regions."
)

LABEL_MEANING = {
    "tumor_et": "enhancing tumor (MSD label 3)",
    "tumor_ncr": "non-enhancing tumor (MSD label 2)",
    "tumor_ed": "edema (MSD label 1)",
}

REASONER_PROMPT = f"""You are the Clinical Reasoner in Jarvis-Neuro, an educational 3D viewer of one brain MRI case
for medical students. It is not for diagnosis or surgical planning.

You receive a question and CASE FACTS, a JSON object copied from the case's manifest.json.

Rules:
- State only facts present in CASE FACTS or arithmetic on them (sums, comparisons, rounding): volumes in mL,
  centroids and bounding boxes in RAS millimetres, hemisphere, distance to the brain surface in mm, provenance
  (ground-truth labels or the MONAI SegResNet model), and Dice against ground truth when it is present.
- RAS means +x patient right, +y anterior, +z superior.
- If the question asks about anatomy, named regions, lobes, function, eloquent cortex, prognosis, risk, grading,
  treatment or surgery, answer with exactly this sentence and nothing else:
  {ATLAS_ANSWER}
- If a needed fact is missing, say it is not in the case data. Never estimate or invent a number.
- Answer in at most three short sentences. The answer is read aloud.
"""


def case_facts(m: Manifest) -> dict[str, Any]:
    tumours = [
        {
            "id": a.id,
            "meaning": LABEL_MEANING[a.id],
            "volume_ml": a.volume_ml,
            "centroid_ras": list(a.centroid_ras),
            "bbox_ras": [list(a.bbox_ras[0]), list(a.bbox_ras[1])],
            "hemisphere": hemisphere_of(a.centroid_ras[0], m.midline_x_ras),
            "min_dist_surface_mm": a.min_dist_surface_mm,
        }
        for a in m.assets
        if isinstance(a, TumorAsset)
    ]
    return {
        "case_id": m.case_id,
        "provenance": m.provenance,
        "midline_x_ras": m.midline_x_ras,
        "tumour_sub_regions": tumours,
        "dice_vs_gt": m.metrics.dice_vs_gt,
    }


def reasoner_input(question: str, m: Manifest) -> str:
    return f"QUESTION: {question}\n\nCASE FACTS:\n{json.dumps(case_facts(m), indent=2)}"


def make_explainer(model: Model) -> Explainer:
    async def explain(question: str, m: Manifest) -> str:
        # A fresh agent per question: the Reasoner keeps no memory between calls.
        reasoner = Agent(model=model, system_prompt=REASONER_PROMPT, callback_handler=None)
        result = await reasoner.invoke_async(reasoner_input(question, m))
        return str(result).strip()

    return explain
