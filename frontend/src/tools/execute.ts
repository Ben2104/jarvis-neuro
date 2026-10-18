import type { z } from 'zod'
import type { LoadedCase } from '../lib/loadCase'
import { formatIssues, hemisphereOf } from '../lib/manifest'
import { sliceRasMm } from '../lib/slice'
import { extractSlice, sliceCount } from '../lib/volume'
import type { ToolSource, ViewerStore } from '../state/store'
import { TOOL_NAMES, isToolName, makeCaseToolSchemas, makeLoadCaseSchema } from './schemas'

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export type ToolResult = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string }

let callCounter = 0
export function newCallId(prefix: string): string {
  callCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${callCounter}`
}

/** What load_case returns: manifest values only, plus the hemisphere derived from centroid x vs midline. */
export function caseSummary(c: LoadedCase) {
  const m = c.manifest
  return {
    case_id: m.case_id,
    provenance: m.provenance,
    dims: m.dims,
    midline_x_ras: m.midline_x_ras,
    assets: m.assets.map((a) =>
      a.kind === 'tumor'
        ? {
            id: a.id,
            kind: a.kind,
            label: a.label,
            volume_ml: a.volume_ml,
            centroid_ras: a.centroid_ras,
            bbox_ras: a.bbox_ras,
            min_dist_surface_mm: a.min_dist_surface_mm,
            hemisphere: hemisphereOf(a.centroid_ras[0], m.midline_x_ras),
          }
        : { id: a.id, kind: a.kind },
    ),
    dice_vs_gt: m.metrics.dice_vs_gt,
  }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function parseArgs<T>(schema: z.ZodType<T>, args: unknown): Parsed<T> {
  const r = schema.safeParse(args ?? {})
  return r.success ? { ok: true, value: r.data } : { ok: false, error: `invalid arguments: ${formatIssues(r.error)}` }
}

async function run(store: ViewerStore, call: ToolCall): Promise<ToolResult> {
  const ok = (result: unknown): ToolResult => ({ id: call.id, ok: true, result })
  const fail = (error: string): ToolResult => ({ id: call.id, ok: false, error })
  const name = call.name
  if (!isToolName(name)) return fail(`unknown tool ${name}; browser tools are ${TOOL_NAMES.join(', ')}`)
  const s = store.getState()

  if (name === 'load_case') {
    const a = parseArgs(makeLoadCaseSchema(s.index), call.args)
    if (!a.ok) return fail(a.error)
    const r = await s.loadCase(a.value.case_id, a.value.provenance)
    return r.ok ? ok(caseSummary(r.loaded)) : fail(r.error)
  }

  const current = s.current
  if (!current) return fail('no case loaded; call load_case first')
  const schemas = makeCaseToolSchemas(current)

  switch (name) {
    case 'set_opacity': {
      const a = parseArgs(schemas.set_opacity, call.args)
      if (!a.ok) return fail(a.error)
      s.setOpacity(a.value.asset_id, a.value.value)
      return ok(a.value)
    }
    case 'focus_region': {
      const a = parseArgs(schemas.focus_region, call.args)
      if (!a.ok) return fail(a.error)
      const asset = current.manifest.assets.find((x) => x.id === a.value.asset_id)!
      s.requestFocus(asset.id)
      if (asset.kind === 'tumor') {
        s.select(asset.id)
        return ok({ asset_id: asset.id, bbox_ras: asset.bbox_ras })
      }
      return ok({ asset_id: asset.id })
    }
    case 'set_cutaway': {
      const a = parseArgs(schemas.set_cutaway, call.args)
      if (!a.ok) return fail(a.error)
      s.setCutaway(a.value.plane, a.value.ras_mm)
      return ok(a.value)
    }
    case 'hide_hemisphere': {
      const a = parseArgs(schemas.hide_hemisphere, call.args)
      if (!a.ok) return fail(a.error)
      s.setHemisphere(a.value.side)
      return ok({ side: a.value.side, midline_x_ras: current.manifest.midline_x_ras })
    }
    case 'toggle_visibility': {
      const a = parseArgs(schemas.toggle_visibility, call.args)
      if (!a.ok) return fail(a.error)
      s.setVisible(a.value.asset_ids, a.value.visible)
      return ok(a.value)
    }
    case 'inspect_mri_slice': {
      const a = parseArgs(schemas.inspect_mri_slice, call.args)
      if (!a.ok) return fail(a.error)
      const { axis, index } = a.value
      s.setSlice(axis, index)
      const labels = new Set(extractSlice(current.mask, axis, index))
      labels.delete(0)
      return ok({
        axis,
        index,
        slice_count: sliceCount(current.frame.dims, axis),
        ras_mm: sliceRasMm(current.frame, axis, index),
        labels_present: [...labels].sort((x, y) => x - y),
      })
    }
  }
}

const brief = (value: unknown) => {
  const text = JSON.stringify(value) ?? ''
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

/** Validate, apply and log one tool call. Never throws for bad input; errors come back as results. */
export async function executeTool(store: ViewerStore, call: ToolCall, source: ToolSource = 'agent'): Promise<ToolResult> {
  let result: ToolResult
  try {
    result = await run(store, call)
  } catch (e) {
    result = { id: call.id, ok: false, error: `tool ${call.name} failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  store.getState().logTool({
    id: call.id,
    name: call.name,
    source,
    args: call.args,
    ok: result.ok,
    text: result.ok ? brief(result.result) : result.error,
    at: Date.now(),
  })
  return result
}
