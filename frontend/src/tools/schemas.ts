import { z } from 'zod'
import { rasExtent } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import { type CaseIndex, PROVENANCES, type Provenance } from '../lib/manifest'
import { AXES, type Axis, RAS_DIM, sliceCount } from '../lib/volume'
import { type CutPlane, type Hemisphere, clampIndex } from '../state/store'

/** Spec §5 tools the browser executes. `explain` runs in the backend (Plan C). */
export const TOOL_NAMES = [
  'load_case',
  'set_opacity',
  'focus_region',
  'set_cutaway',
  'hide_hemisphere',
  'toggle_visibility',
  'inspect_mri_slice',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]
export type CaseToolName = Exclude<ToolName, 'load_case'>

export const CUT_PLANES = ['axial', 'coronal', 'sagittal', 'none'] as const satisfies readonly CutPlane[]
export const HEMISPHERES = ['left', 'right', 'none'] as const satisfies readonly Hemisphere[]

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

/** Arguments after validation and clamping. */
export interface ToolArgs {
  load_case: { case_id: string; provenance?: Provenance }
  set_opacity: { asset_id: string; value: number }
  focus_region: { asset_id: string }
  set_cutaway: { plane: CutPlane; ras_mm: number }
  hide_hemisphere: { side: Hemisphere }
  toggle_visibility: { asset_ids: string[]; visible: boolean }
  inspect_mri_slice: { axis: Axis; index: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function oneOf(allowed: string[], what: string) {
  return z.string().refine((v) => allowed.includes(v), {
    error: (issue) => `unknown ${what} ${JSON.stringify(issue.input)}; expected one of ${allowed.join(', ')}`,
  })
}

export function makeLoadCaseSchema(index: CaseIndex | null): z.ZodType<ToolArgs['load_case']> {
  const caseIds = [...new Set(index?.cases.map((c) => c.case_id) ?? [])]
  return z.strictObject({ case_id: oneOf(caseIds, 'case_id'), provenance: z.enum(PROVENANCES).optional() })
    .superRefine(({ case_id, provenance }, ctx) => {
      if (provenance === undefined || !caseIds.includes(case_id)) return
      const available = index!.cases.filter((c) => c.case_id === case_id).map((c) => c.provenance)
      if (!available.includes(provenance)) {
        ctx.addIssue({
          code: 'custom',
          path: ['provenance'],
          message: `no case ${case_id} with provenance ${provenance}; available: ${available.join(', ')}`,
        })
      }
    })
}

export function makeCaseToolSchemas(c: LoadedCase): { [K in CaseToolName]: z.ZodType<ToolArgs[K]> } {
  const assetId = oneOf(
    c.manifest.assets.map((a) => a.id),
    'asset_id',
  )
  const extent = rasExtent(c.frame)
  return {
    set_opacity: z.strictObject({ asset_id: assetId, value: z.number().transform((v) => clamp(v, 0, 1)) }),
    focus_region: z.strictObject({ asset_id: assetId }),
    set_cutaway: z
      .strictObject({ plane: z.enum(CUT_PLANES), ras_mm: z.number().optional() })
      .transform((a, ctx) => {
        if (a.plane === 'none') return { plane: a.plane, ras_mm: 0 }
        if (a.ras_mm === undefined) {
          ctx.issues.push({ code: 'custom', message: 'ras_mm is required unless plane is none', input: a, path: ['ras_mm'] })
          return z.NEVER
        }
        const d = RAS_DIM[a.plane]
        return { plane: a.plane, ras_mm: clamp(a.ras_mm, extent.min[d], extent.max[d]) }
      }),
    hide_hemisphere: z.strictObject({ side: z.enum(HEMISPHERES) }),
    toggle_visibility: z.strictObject({ asset_ids: z.array(assetId).min(1), visible: z.boolean() }),
    inspect_mri_slice: z
      .strictObject({ axis: z.enum(AXES), index: z.number() })
      .transform((a) => ({ axis: a.axis, index: clampIndex(Math.round(a.index), sliceCount(c.frame.dims, a.axis)) })),
  }
}
