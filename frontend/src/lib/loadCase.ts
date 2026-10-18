import { type Mesh, type Object3D, Vector3 } from 'three'
import { parseGlb as defaultParseGlb } from '../scene/gltf'
import { type CaseFrame, applyAffine, makeFrame, rasExtent } from './affine'
import {
  type CaseIndex,
  type CaseIndexEntry,
  CaseIndexSchema,
  type Manifest,
  ManifestSchema,
  type Vec3,
  formatIssues,
} from './manifest'
import { Volume } from './volume'

export const CASES_ROOT = '/cases/'

export interface CaseDeps {
  fetchFn?: typeof fetch
  root?: string
  parseGlb?: (buffer: ArrayBuffer) => Promise<Object3D>
}

export class CaseLoadError extends Error {
  override name = 'CaseLoadError'
}

/** Axis-aligned box in RAS millimetres. */
export interface RasBox {
  min: Vec3
  max: Vec3
}

export interface LoadedCase {
  entry: CaseIndexEntry
  manifest: Manifest
  baseUrl: string
  glbUrl: string
  frame: CaseFrame
  flair: Volume
  mask: Volume
  scene: Object3D
  /** Extent of the surface asset, measured from the GLB: the manifest carries no bbox for it. */
  brainBoxRas: RasBox
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function getBytes(fetchFn: typeof fetch, url: string): Promise<Uint8Array<ArrayBuffer>> {
  let res: Response
  try {
    res = await fetchFn(url)
  } catch (e) {
    throw new CaseLoadError(`could not fetch ${url}: ${messageOf(e)}`)
  }
  if (!res.ok) throw new CaseLoadError(`HTTP ${res.status} for ${url}`)
  if (res.headers.get('content-type')?.includes('text/html')) {
    throw new CaseLoadError(`${url} returned an HTML page, not the file (missing from public/cases?)`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const bytes = await getBytes(fetchFn, url)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new CaseLoadError(`${url} is not JSON`)
  }
}

function toVolume(frame: CaseFrame, bytes: Uint8Array, url: string): Volume {
  try {
    return new Volume(frame.dims, bytes)
  } catch (e) {
    throw new CaseLoadError(
      `${url}: ${messageOf(e)}. If the file is stored gzip-compressed, serve it with Content-Encoding: gzip.`,
    )
  }
}

function assertAssetNodes(manifest: Manifest, scene: Object3D, glbUrl: string) {
  for (const asset of manifest.assets) {
    const node = scene.getObjectByName(asset.node) as Mesh | undefined
    if (!node?.isMesh) throw new CaseLoadError(`asset ${asset.id}: no mesh named "${asset.node}" in ${glbUrl}`)
  }
}

/** RAS bounds of the surface mesh's vertices (the explode view needs the brain's width and centre). */
export function measureBrainBox(manifest: Manifest, scene: Object3D, frame: CaseFrame): RasBox {
  const surface = manifest.assets.find((a) => a.kind === 'surface')
  const mesh = surface && (scene.getObjectByName(surface.node) as Mesh | undefined)
  if (!mesh) return rasExtent(frame)
  scene.updateMatrixWorld(true)
  const position = mesh.geometry.getAttribute('position')
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    const ras = applyAffine(frame.gl2ras, [v.x, v.y, v.z])
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], ras[a])
      max[a] = Math.max(max[a], ras[a])
    }
  }
  return position.count > 0 ? { min, max } : rasExtent(frame)
}

export async function fetchIndex(deps: CaseDeps = {}): Promise<CaseIndex> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis)
  const url = `${deps.root ?? CASES_ROOT}index.json`
  const parsed = CaseIndexSchema.safeParse(await getJson(fetchFn, url))
  if (!parsed.success) throw new CaseLoadError(`${url} invalid: ${formatIssues(parsed.error)}`)
  return parsed.data
}

export async function fetchCase(entry: CaseIndexEntry, deps: CaseDeps = {}): Promise<LoadedCase> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis)
  const parse = deps.parseGlb ?? defaultParseGlb
  const manifestUrl = `${deps.root ?? CASES_ROOT}${entry.path}`
  const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)

  const parsed = ManifestSchema.safeParse(await getJson(fetchFn, manifestUrl))
  if (!parsed.success) throw new CaseLoadError(`manifest invalid: ${formatIssues(parsed.error)}`)
  const manifest = parsed.data
  if (manifest.case_id !== entry.case_id || manifest.provenance !== entry.provenance) {
    throw new CaseLoadError(
      `${manifestUrl} is ${manifest.case_id}/${manifest.provenance}, index says ${entry.case_id}/${entry.provenance}`,
    )
  }

  const diagonal = [manifest.vox2ras[0], manifest.vox2ras[5], manifest.vox2ras[10]]
  const tolerance = 1e-6 * Math.max(...diagonal)
  if (diagonal.some((v) => v <= 0) || [1, 2, 4, 6, 8, 9].some((i) => Math.abs(manifest.vox2ras[i]) > tolerance)) {
    throw new CaseLoadError(
      `${manifestUrl}: vox2ras is not RAS-canonical (positive diagonal, no rotation); the 2D panel would show wrong laterality`,
    )
  }

  const frame = makeFrame(manifest)
  const flairUrl = baseUrl + manifest.volumes.flair
  const maskUrl = baseUrl + manifest.volumes.mask
  const glbUrl = baseUrl + manifest.glb
  const [flairBytes, maskBytes, glbBytes] = await Promise.all([
    getBytes(fetchFn, flairUrl),
    getBytes(fetchFn, maskUrl),
    getBytes(fetchFn, glbUrl),
  ])
  const flair = toVolume(frame, flairBytes, flairUrl)
  const mask = toVolume(frame, maskBytes, maskUrl)

  let scene: Object3D
  try {
    scene = await parse(glbBytes.buffer)
  } catch (e) {
    throw new CaseLoadError(`could not parse glTF ${glbUrl}: ${messageOf(e)}`)
  }
  assertAssetNodes(manifest, scene, glbUrl)

  const brainBoxRas = measureBrainBox(manifest, scene, frame)

  return { entry, manifest, baseUrl, glbUrl, frame, flair, mask, scene, brainBoxRas }
}
