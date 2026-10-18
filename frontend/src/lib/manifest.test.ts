import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PUBLIC_DIR, SHARED_SCHEMA_PATH, readJson, readSynthManifestJson } from '../test/fixtures'
import {
  CaseIndexSchema,
  ManifestSchema,
  ManifestShape,
  MetricsSchema,
  PROVENANCES,
  SurfaceAssetSchema,
  TUMOR_IDS,
  TumorAssetSchema,
  VolumesSchema,
  formatIssues,
  hemisphereOf,
  tumorAssets,
} from './manifest'

function expectInvalid(value: unknown, pattern: RegExp) {
  const r = ManifestSchema.safeParse(value)
  expect(r.success).toBe(false)
  if (!r.success) expect(formatIssues(r.error)).toMatch(pattern)
}

describe('ManifestSchema', () => {
  it('accepts the committed synthetic manifest', () => {
    const m = ManifestSchema.parse(readSynthManifestJson())
    expect(m.case_id).toBe('synth_001')
    expect(tumorAssets(m).map((t) => t.id)).toEqual(['tumor_et', 'tumor_ncr', 'tumor_ed'])
    expect(m.metrics.dice_vs_gt).toBeNull()
  })

  it('rejects an asset without kind', () => {
    const m = readSynthManifestJson()
    delete m.assets[1].kind
    expectInvalid(m, /assets\.1/)
  })

  it('rejects a manifest without brain_surface', () => {
    const m = readSynthManifestJson()
    m.assets = m.assets.filter((a: { id: string }) => a.id !== 'brain_surface')
    expectInvalid(m, /exactly one brain_surface/)
  })

  it('rejects duplicate asset ids', () => {
    const m = readSynthManifestJson()
    m.assets.push(structuredClone(m.assets[1]))
    expectInvalid(m, /unique/)
  })

  it('rejects a tumour whose label does not match its id', () => {
    const m = readSynthManifestJson()
    m.assets[1].label = 1
    expectInvalid(m, /label 1 does not match tumor_et/)
  })

  it('rejects unknown keys', () => {
    const m = readSynthManifestJson()
    m.assets[1].motor_strip = true
    expectInvalid(m, /Unrecognized key/)
  })

  it('rejects non-integer dims', () => {
    const m = readSynthManifestJson()
    m.dims[2] = 47.5
    expectInvalid(m, /dims\.2/)
  })

  it('accepts the committed case index', () => {
    const index = CaseIndexSchema.parse(readJson(join(PUBLIC_DIR, 'cases/index.json')))
    expect(index.cases.length).toBeGreaterThan(0)
    expect(index.cases).toContainEqual({
      case_id: 'synth_001',
      provenance: 'synthetic',
      path: 'synth_001/synthetic/manifest.json',
    })
  })
})

describe('parity with shared/manifest.schema.json', () => {
  const shared = JSON.parse(readFileSync(SHARED_SCHEMA_PATH, 'utf8'))
  const pairs: [string, { properties: object; required?: string[] }, z.ZodType][] = [
    ['Manifest', shared, ManifestShape],
    ['SurfaceAsset', shared.$defs.SurfaceAsset, SurfaceAssetSchema],
    ['TumorAsset', shared.$defs.TumorAsset, TumorAssetSchema],
    ['Volumes', shared.$defs.Volumes, VolumesSchema],
    ['Metrics', shared.$defs.Metrics, MetricsSchema],
  ]

  it.each(pairs)('%s has the same keys, required keys and strictness', (_name, def, schema) => {
    const mine = z.toJSONSchema(schema, { io: 'input' }) as {
      properties: object
      required?: string[]
      additionalProperties?: boolean
    }
    expect(Object.keys(mine.properties).sort()).toEqual(Object.keys(def.properties).sort())
    expect([...(mine.required ?? [])].sort()).toEqual([...(def.required ?? [])].sort())
    expect(mine.additionalProperties).toBe(false)
  })

  it('has the same enums', () => {
    expect([...PROVENANCES]).toEqual(shared.properties.provenance.enum)
    expect([...TUMOR_IDS]).toEqual(shared.$defs.TumorAsset.properties.id.enum)
    expect(shared.$defs.TumorAsset.properties.label.enum).toEqual([1, 2, 3])
    expect(shared.$defs.TumorAsset.properties.color.pattern).toBe('^#[0-9A-Fa-f]{6}$')
    expect(shared.properties.case_id.pattern).toBe('^[a-z0-9_]+$')
  })
})

describe('hemisphereOf', () => {
  it('uses RAS: x below the midline is the left hemisphere', () => {
    expect(hemisphereOf(-24, 0)).toBe('left')
    expect(hemisphereOf(5, 0)).toBe('right')
    expect(hemisphereOf(2, 2)).toBe('midline')
  })
})
