import { FrontSide, type Mesh, MeshStandardMaterial, Raycaster, ShaderLib, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { rasToScene, sceneToRas } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import type { Vec3 } from '../lib/manifest'
import { initialViewFor } from '../state/store'
import { loadSynth } from '../test/fixtures'
import { cutawayPlane, hemispherePlane } from './clipping'
import { assetBox } from './focus'
import { HOVER_EMISSIVE, SELECTED_EMISSIVE, addFresnelRim } from './materials'
import { pickTumor } from './picking'
import { type PreparedCase, prepareCase, releaseCase } from './prepare'
import { type SceneView, applyViewState } from './viewState'

let c: LoadedCase
let p: PreparedCase

const v3 = (a: Vec3) => new Vector3(...a)
const defaults = (): SceneView => ({ ...initialViewFor(c) })

beforeAll(async () => {
  c = await loadSynth()
  p = prepareCase(c)
  p.root.updateMatrixWorld(true)
})

/** A ray along RAS -y (anterior to posterior) through the tumour centroid. */
function rayFromFront(): Raycaster {
  const from = v3(rasToScene(c.frame, [-24, 218, 3]))
  const to = v3(rasToScene(c.frame, [-24, 18, 3]))
  return new Raycaster(from, to.sub(from).normalize())
}

describe('prepareCase', () => {
  it('replaces the GLB shared material with one material per asset', async () => {
    const raw = await loadSynth()
    const uuids = ['brain_surface', 'tumor_et', 'tumor_ncr', 'tumor_ed'].map(
      (id) => ((raw.scene.getObjectByName(id) as Mesh).material as MeshStandardMaterial).uuid,
    )
    expect(new Set(uuids).size).toBe(1)

    const mats = [...p.materials.values()]
    expect(new Set(mats.map((m) => m.uuid)).size).toBe(4)
    for (const [id, mesh] of p.meshes) {
      expect(mesh.material).toBe(p.materials.get(id))
      expect(mesh.userData.assetId).toBe(id)
      expect(mesh.geometry.getAttribute('normal')).toBeDefined()
    }
  })

  it('scales the case root from millimetres to metres and caches per case', () => {
    expect(p.root.scale.toArray()).toEqual([0.001, 0.001, 0.001])
    expect(prepareCase(c)).toBe(p)
    expect(p.tumorMeshes.map((m) => m.userData.assetId)).toEqual(['tumor_et', 'tumor_ncr', 'tumor_ed'])
  })

  it('builds the brain material per spec §6 and tumour colours from the manifest', () => {
    const brain = p.materials.get('brain_surface')!
    expect(brain.transparent).toBe(true)
    expect(brain.opacity).toBe(0.45)
    expect(brain.depthWrite).toBe(false)
    expect(brain.side).toBe(FrontSide)
    expect(brain.customProgramCacheKey()).toBe('fresnel-rim')
    expect(p.materials.get('tumor_et')!.color.getHexString()).toBe('e8705a')
    expect(p.materials.get('tumor_ed')!.color.getHexString()).toBe('e3a857')
  })

  it('places geometry where rasToScene puts the manifest centroid', () => {
    const box = assetBox(p, 'tumor_et')!
    expect(box.containsPoint(v3(rasToScene(c.frame, [-24, 18, 3])))).toBe(true)
    expect(assetBox(p, 'brain_surface')!.containsBox(assetBox(p, 'tumor_ed')!)).toBe(true)
    expect(assetBox(p, 'nope')).toBeNull()
  })
})

describe('addFresnelRim', () => {
  it('injects the rim term before opaque_fragment', () => {
    const mat = new MeshStandardMaterial()
    addFresnelRim(mat)
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: ShaderLib.physical.fragmentShader }
    mat.onBeforeCompile(shader as never, null as never)
    expect(shader.fragmentShader).toContain('uniform vec3 uRimColor;')
    const fs = shader.fragmentShader
    expect(fs.indexOf('outgoingLight += uRimColor * rim;')).toBeGreaterThan(fs.indexOf('vec3 outgoingLight ='))
    expect(fs.indexOf('outgoingLight += uRimColor * rim;')).toBeLessThan(fs.indexOf('#include <opaque_fragment>'))
    expect(Object.keys(shader.uniforms)).toEqual(['uRimColor', 'uRimPower'])
  })
})

describe('clipping planes', () => {
  it('cutaway removes the side above ras_mm', () => {
    const plane = cutawayPlane(c.frame, 'axial', 3)
    expect(plane.distanceToPoint(v3(rasToScene(c.frame, [0, 0, 10])))).toBeLessThan(0)
    expect(plane.distanceToPoint(v3(rasToScene(c.frame, [0, 0, -10])))).toBeGreaterThan(0)
    const sag = cutawayPlane(c.frame, 'sagittal', -24)
    expect(sag.distanceToPoint(v3(rasToScene(c.frame, [0, 0, 0])))).toBeLessThan(0)
  })

  it('hiding the left hemisphere removes RAS x below the midline', () => {
    const left = hemispherePlane(c.frame, 'left', 0)
    expect(left.distanceToPoint(v3(rasToScene(c.frame, [-24, 18, 3])))).toBeLessThan(0)
    expect(left.distanceToPoint(v3(rasToScene(c.frame, [24, 18, 3])))).toBeGreaterThan(0)
    const right = hemispherePlane(c.frame, 'right', 0)
    expect(right.distanceToPoint(v3(rasToScene(c.frame, [24, 18, 3])))).toBeLessThan(0)
  })
})

describe('applyViewState', () => {
  it('orders opaque tumours, then translucent tumours, then the brain', () => {
    applyViewState(p, c, defaults())
    const order = Object.fromEntries([...p.meshes].map(([id, m]) => [id, m.renderOrder]))
    expect(order).toEqual({ tumor_et: 0, tumor_ncr: 0, tumor_ed: 1, brain_surface: 2 })
    expect(p.materials.get('tumor_ed')!.transparent).toBe(true)
    expect(p.materials.get('tumor_ed')!.depthWrite).toBe(false)
    expect(p.materials.get('tumor_et')!.transparent).toBe(false)
    expect([...p.materials.values()].every((m) => m.clippingPlanes === null)).toBe(true)
  })

  it('clips every asset for a cutaway and only the brain for a hemisphere', () => {
    applyViewState(p, c, { ...defaults(), cutaway: { plane: 'axial', rasMm: 3 }, hemisphere: 'left' })
    expect(p.materials.get('brain_surface')!.clippingPlanes).toHaveLength(2)
    expect(p.materials.get('tumor_et')!.clippingPlanes).toHaveLength(1)
    applyViewState(p, c, { ...defaults(), hemisphere: 'right' })
    expect(p.materials.get('brain_surface')!.clippingPlanes).toHaveLength(1)
    expect(p.materials.get('tumor_et')!.clippingPlanes).toBeNull()
  })

  it('highlights hover over selection and hides invisible or zero-opacity assets', () => {
    applyViewState(p, c, {
      ...defaults(),
      hovered: 'tumor_et',
      selected: 'tumor_ncr',
      visible: { ...defaults().visible, tumor_ed: false },
      opacity: { ...defaults().opacity, brain_surface: 0 },
    })
    expect(p.materials.get('tumor_et')!.emissiveIntensity).toBe(HOVER_EMISSIVE)
    expect(p.materials.get('tumor_ncr')!.emissiveIntensity).toBe(SELECTED_EMISSIVE)
    expect(p.meshes.get('tumor_ed')!.visible).toBe(false)
    expect(p.meshes.get('brain_surface')!.visible).toBe(false)
    applyViewState(p, c, defaults())
  })
})

describe('pickTumor', () => {
  it('hits the outer tumour shell and never the brain surface', () => {
    applyViewState(p, c, defaults())
    const all = rayFromFront().intersectObject(p.root, true)
    expect(all.some((h) => h.object.userData.assetId === 'brain_surface')).toBe(false)
    expect(pickTumor(rayFromFront(), p)?.assetId).toBe('tumor_ed')
  })

  it('skips hidden tumours', () => {
    applyViewState(p, c, { ...defaults(), visible: { ...defaults().visible, tumor_ed: false } })
    expect(pickTumor(rayFromFront(), p)?.assetId).toBe('tumor_et')
    applyViewState(p, c, defaults())
  })

  it('skips hits on the clipped-away side of a cutaway', () => {
    applyViewState(p, c, { ...defaults(), cutaway: { plane: 'coronal', rasMm: 10 } })
    const hit = pickTumor(rayFromFront(), p)!
    expect(sceneToRas(c.frame, hit.point.toArray() as Vec3)[1]).toBeLessThanOrEqual(10 + 1e-6)
    applyViewState(p, c, defaults())
  })
})

describe('releaseCase', () => {
  it('detaches the root and drops the cache entry', async () => {
    const other = await loadSynth()
    const prepared = prepareCase(other)
    releaseCase(other)
    expect(prepared.root.children).toHaveLength(0)
    expect(prepareCase(other)).not.toBe(prepared)
    releaseCase(other)
  })
})
