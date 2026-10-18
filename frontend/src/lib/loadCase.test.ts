import { Mesh, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { fsFetch, readSynthManifestJson, synthEntry } from '../test/fixtures'
import { CaseLoadError, fetchCase, fetchIndex } from './loadCase'

const BASE = '/cases/synth_001/synthetic/'
const json = (value: unknown) => () => new Response(JSON.stringify(value))

async function loadError(overrides: Record<string, () => Response>, entry = synthEntry, parseGlb?: () => Promise<Object3D>) {
  const err = await fetchCase(entry, { fetchFn: fsFetch(overrides), parseGlb }).then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(CaseLoadError)
  return (err as Error).message
}

describe('fetchIndex', () => {
  it('reads and validates index.json', async () => {
    const index = await fetchIndex({ fetchFn: fsFetch() })
    expect(index.cases).toEqual([synthEntry])
  })

  it('rejects an invalid index', async () => {
    const err = await fetchIndex({ fetchFn: fsFetch({ '/cases/index.json': json({ cases: [{ case_id: 'X' }] }) }) }).catch(
      (e: Error) => e,
    )
    expect(err).toBeInstanceOf(CaseLoadError)
    expect((err as Error).message).toMatch(/index.json invalid/)
  })
})

describe('fetchCase', () => {
  it('loads the synthetic case', async () => {
    const c = await fetchCase(synthEntry, { fetchFn: fsFetch() })
    expect(c.manifest.case_id).toBe('synth_001')
    expect(c.baseUrl).toBe(BASE)
    expect(c.glbUrl).toBe(`${BASE}case.glb`)
    expect(c.flair.dims).toEqual([56, 64, 48])
    expect(c.mask.get(19, 38, 25)).toBeGreaterThan(0)
    for (const id of ['brain_surface', 'tumor_et', 'tumor_ncr', 'tumor_ed']) {
      expect((c.scene.getObjectByName(id) as Mesh).isMesh).toBe(true)
    }
  })

  it('reports an HTTP failure with the URL', async () => {
    expect(await loadError({ [`${BASE}manifest.json`]: () => new Response('gone', { status: 404 }) })).toMatch(
      `HTTP 404 for ${BASE}manifest.json`,
    )
  })

  it('reports a manifest that fails the schema', async () => {
    const m = readSynthManifestJson()
    delete m.assets[2].kind
    expect(await loadError({ [`${BASE}manifest.json`]: json(m) })).toMatch(/^manifest invalid: assets\.2/)
  })

  it('reports a manifest that is not JSON', async () => {
    expect(await loadError({ [`${BASE}manifest.json`]: () => new Response('<html>') })).toMatch(/is not JSON/)
  })

  it('reports a manifest that disagrees with the index', async () => {
    expect(await loadError({}, { ...synthEntry, provenance: 'ground-truth' })).toMatch(
      /is synth_001\/synthetic, index says synth_001\/ground-truth/,
    )
  })

  it.each([
    [0, -3], [5, 0], [10, -3],
    [1, 0.01], [2, -0.01], [4, 0.01], [6, -0.01], [8, 0.01], [9, -0.01],
  ])('rejects noncanonical vox2ras entry %i = %s', async (at, value) => {
    const m = readSynthManifestJson()
    m.vox2ras[at] = value
    expect(await loadError({ [`${BASE}manifest.json`]: json(m) })).toMatch(/RAS-canonical/)
  })

  it('accepts off-diagonal noise within the spacing-scaled tolerance', async () => {
    const m = readSynthManifestJson()
    m.vox2ras[1] = 3e-6
    m.vox2ras[4] = -3e-6
    const c = await fetchCase(synthEntry, { fetchFn: fsFetch({ [`${BASE}manifest.json`]: json(m) }) })
    expect(c.manifest.vox2ras).toEqual(m.vox2ras)
  })

  it('reports a truncated volume with the gzip hint', async () => {
    const msg = await loadError({ [`${BASE}mask_u8.bin`]: () => new Response(new Uint8Array(1000)) })
    expect(msg).toMatch(/mask_u8\.bin: volume has 1000 bytes, expected 172032/)
    expect(msg).toMatch(/Content-Encoding: gzip/)
  })

  it('reports an HTML fallback instead of a missing FLAIR volume', async () => {
    const msg = await loadError({
      [`${BASE}flair_u8.bin`]: () => new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    })
    expect(msg).toMatch(/HTML page/)
    expect(msg).toContain(`${BASE}flair_u8.bin`)
    expect(msg).not.toMatch(/gzip/)
  })

  it('reports an unparseable GLB', async () => {
    expect(await loadError({ [`${BASE}case.glb`]: () => new Response(new Uint8Array([1, 2, 3, 4])) })).toMatch(
      /could not parse glTF/,
    )
  })

  it('reports a GLB without the manifest nodes', async () => {
    expect(await loadError({}, synthEntry, async () => new Object3D())).toMatch(
      /asset brain_surface: no mesh named "brain_surface"/,
    )
  })
})
