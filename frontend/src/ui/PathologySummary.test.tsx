import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ManifestSchema } from '../lib/manifest'
import { readSynthManifestJson } from '../test/fixtures'
import { ATLAS_ONLY } from './format'
import { PathologySummaryView, TumorPlacedBanner, pathologyFacts } from './PathologySummary'

const manifest = ManifestSchema.parse(readSynthManifestJson())
const empty = { ...manifest, assets: manifest.assets.filter((a) => a.kind !== 'tumor') }

it('derives volume, side and margin from the manifest only', () => {
  const f = pathologyFacts(manifest)!
  expect(f.volume).toBe('38.31 mL')
  expect(['left', 'right', 'midline']).toContain(f.side)
  expect(f.margin).toMatch(/^\d+\.\d mm$/)
})

it('has no facts without a tumor', () => {
  expect(pathologyFacts(empty)).toBeNull()
})

it('summary shows manifest values and atlas-only text for classifier fields', () => {
  const html = renderToStaticMarkup(<PathologySummaryView manifest={manifest} />)
  expect(html).toContain(`Detected from MRI series ${manifest.case_id}`)
  expect(html).toContain('38.31 mL')
  expect(html).toContain('to brain surface')
  expect(html).toContain(ATLAS_ONLY)
  expect(html).not.toMatch(/Glioblastoma|Hippocampus|capsule/)
})

it('summary says no tumor detected when there is none', () => {
  expect(renderToStaticMarkup(<PathologySummaryView manifest={empty} />)).toContain('No tumor detected')
})

it('banner reports placement with computed facts and an undo', () => {
  const html = renderToStaticMarkup(<TumorPlacedBanner manifest={manifest} onUndo={() => {}} />)
  expect(html).toContain('Tumor placed on the 3D brain')
  expect(html).toContain('38.31 mL')
  expect(html).toContain('approximate placement')
  expect(html).toContain('Undo')
  expect(html).not.toContain(ATLAS_ONLY)
})

it('banner renders nothing without a tumor', () => {
  expect(renderToStaticMarkup(<TumorPlacedBanner manifest={empty} onUndo={() => {}} />)).toBe('')
})
