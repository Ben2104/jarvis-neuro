"""The Orchestrator: one Strands agent per browser connection, holding every tool (spec §5 Roles)."""
import asyncio

from strands import Agent
from strands.models.model import Model

from .reasoner import Explainer
from .tools import SceneContext, make_tools

ORCHESTRATOR_PROMPT = """You are Jarvis, the voice assistant of Jarvis-Neuro, an educational 3D viewer of one brain
MRI case for medical students. It is not for diagnosis or surgical planning.

You control the viewer only through your tools. The user sees the result on screen.

Rules:
- Every number you say must come from a tool result. Never invent a volume, a coordinate or a slice index.
- Asset ids are brain_surface, tumor_et (enhancing tumor), tumor_ncr (non-enhancing tumor) and tumor_ed (edema).
  There are no named brain regions in this build.
- For set_cutaway, take ras_mm from a centroid_ras or bbox_ras value in the load_case result.
  RAS components are x (patient right), y (anterior), z (superior): sagittal uses x, coronal y, axial z.
- For inspect_mri_slice, prefer focus_region on a tumour sub-region, which moves the slice for you. Use an index
  only from a previous inspect_mri_slice result or when the user names one.
- Questions about the case's findings, meaning, anatomy, function or risk go to explain. Repeat its answer.
- If a tool returns an error, say in one short sentence that you could not do it and why.
- If no case is loaded, call load_case first.
- Reply in at most two short sentences. Replies are read aloud.
"""


class OrchestratorSession:
    def __init__(self, ctx: SceneContext, model: Model, explainer: Explainer):
        self.ctx = ctx
        self.agent = Agent(
            model=model,
            tools=make_tools(ctx, explainer),
            system_prompt=ORCHESTRATOR_PROMPT,
            callback_handler=None,
        )
        # A Strands agent runs one invocation at a time; later messages wait their turn.
        self._lock = asyncio.Lock()

    async def ask(self, text: str) -> str:
        async with self._lock:
            result = await self.agent.invoke_async(text)
        return str(result).strip()
