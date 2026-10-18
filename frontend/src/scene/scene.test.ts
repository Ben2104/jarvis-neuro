import { Box3, FrontSide, type Mesh, MeshStandardMaterial, Raycaster, ShaderLib, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { rasToScene, sceneToRas } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import { explodeOffsets } from '../lib/explode'
import { type Vec3, tumorAssets } from '../lib/manifest'
import { initialViewFor } from '../state/store'
import { loadSynth } from '../test/fixtures'
import { cutawayPlane, hemispherePlane } from './clipping'
import { assetBox } from './focus'
import { HOVER_EMISSIVE, SELECTED_EMISSIVE, addFresnelRim } from './materials'
import { isClippedAway, pickTumor } from './picking'
import { type PreparedCase, prepareCase, releaseCase } from './prepare'
import { type SceneView, applyViewState, sceneOffset } from './viewState'

let c: LoadedCase
let p: PreparedCase

const v3 = (a: Vec3) => new Vector3(...a)
const sceneOffsetVec = (ras: Vec3) => sceneOffset(c, ras)
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
    expect(brain.customProgramCacheKey()).toBe('cortex-rim')
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
    // The brain halves are always clipped to their own side of the midline; nothing else is clipped by default.
    for (const part of p.parts) {
      if (part.hemisphere) expect(part.material.clippingPlanes).toHaveLength(1)
      else expect(part.material.clippingPlanes).toBeNull()
    }
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

describe('two-mesh brain', () => {
  const half = (side: 'left' | 'right') => p.parts.find((x) => x.assetId === 'brain_surface' && x.hemisphere === side)!
  const probe = (x: number): Vector3 => v3(rasToScene(c.frame, [x, 0, 0]))

  it('builds one mesh per hemisphere on shared geometry with separate materials', () => {
    const [l, r] = [half('left'), half('right')]
    expect(l.mesh).not.toBe(r.mesh)
    expect(l.mesh.geometry).toBe(r.mesh.geometry)
    expect(l.material).not.toBe(r.material)
    expect(l.material.customProgramCacheKey()).toBe('cortex-rim')
    expect(r.mesh.userData.assetId).toBe('brain_surface')
    expect(r.mesh.parent).toBe(l.mesh.parent)
    expect(p.parts.filter((x) => x.assetId === 'brain_surface')).toHaveLength(2)
  })

  it('clips each half to its own side of the midline', () => {
    applyViewState(p, c, defaults())
    const [lp] = half('left').material.clippingPlanes!
    const [rp] = half('right').material.clippingPlanes!
    expect(lp.distanceToPoint(probe(-10))).toBeGreaterThan(0)
    expect(lp.distanceToPoint(probe(10))).toBeLessThan(0)
    expect(rp.distanceToPoint(probe(10))).toBeGreaterThan(0)
    expect(rp.distanceToPoint(probe(-10))).toBeLessThan(0)
  })

  it('hides the matching mesh for hide-hemisphere instead of clipping it', () => {
    applyViewState(p, c, { ...defaults(), hemisphere: 'left' })
    expect(half('left').mesh.visible).toBe(false)
    expect(half('right').mesh.visible).toBe(true)
    expect(half('right').material.clippingPlanes).toHaveLength(1)
    applyViewState(p, c, { ...defaults(), hemisphere: 'right' })
    expect(half('left').mesh.visible).toBe(true)
    expect(half('right').mesh.visible).toBe(false)
    applyViewState(p, c, defaults())
  })

  it('applies brain_surface opacity and visibility to both halves', () => {
    applyViewState(p, c, { ...defaults(), opacity: { ...defaults().opacity, brain_surface: 0.2 } })
    expect(half('left').material.opacity).toBe(0.2)
    expect(half('right').material.opacity).toBe(0.2)
    applyViewState(p, c, { ...defaults(), visible: { ...defaults().visible, brain_surface: false } })
    expect(p.parts.filter((x) => x.assetId === 'brain_surface').every((x) => !x.mesh.visible)).toBe(true)
    applyViewState(p, c, defaults())
  })
})

describe('explode', () => {
  const exploded = (explode: number, over: Partial<SceneView> = {}): SceneView => ({ ...defaults(), explode, ...over })
  const offsetsAt = (t: number) => explodeOffsets(c.manifest, c.brainBoxRas, t)
  const meshOf = (id: string, side?: 'left' | 'right') =>
    p.parts.find((x) => x.assetId === id && (side === undefined || x.hemisphere === side))!

  it('leaves everything where it was loaded at 0', () => {
    applyViewState(p, c, exploded(0))
    for (const part of p.parts) expect(part.mesh.position.toArray()).toEqual(part.basePosition.toArray())
  })

  it('slides the hemispheres apart along RAS x and returns them when reassembled', () => {
    const before = assetBox(p, 'brain_surface')!.getSize(new Vector3())
    applyViewState(p, c, exploded(1))
    const o = offsetsAt(1)
    const world = (side: 'left' | 'right') => new Box3().setFromObject(meshOf('brain_surface', side).mesh).getCenter(new Vector3())
    applyViewState(p, c, exploded(0))
    const home = { left: world('left'), right: world('right') }
    applyViewState(p, c, exploded(1))
    for (const side of ['left', 'right'] as const) {
      const moved = world(side).sub(home[side])
      expect(moved.distanceTo(sceneOffsetVec(o[side]))).toBeLessThan(1e-9)
    }
    // ras2gl negates x, so the left half (-x RAS) goes to +x in GL; either way the box widens by both shifts.
    const after = assetBox(p, 'brain_surface')!.getSize(new Vector3())
    expect(after.length()).toBeGreaterThan(before.length())
    applyViewState(p, c, exploded(0))
    expect(world('left').distanceTo(home.left)).toBeLessThan(1e-12)
  })

  it('moves a tumour by its offset and fits the camera to the shifted box', () => {
    const home = assetBox(p, 'tumor_ncr')!.getCenter(new Vector3())
    applyViewState(p, c, exploded(1))
    const o = offsetsAt(1).assets.tumor_ncr
    expect(Math.hypot(...o)).toBeGreaterThan(0)
    const moved = assetBox(p, 'tumor_ncr')!.getCenter(new Vector3()).sub(home)
    expect(moved.distanceTo(sceneOffsetVec(o))).toBeLessThan(1e-9)
    applyViewState(p, c, exploded(0))
  })

  it('translates cutaway and hemisphere planes with each moved mesh', () => {
    const cutaway = { plane: 'coronal' as const, rasMm: 10 }
    applyViewState(p, c, exploded(0, { cutaway }))
    const rest = p.parts.map((x) => x.material.clippingPlanes!.map((pl) => pl.clone()))
    applyViewState(p, c, exploded(1, { cutaway }))
    p.parts.forEach((part, i) => {
      const shift = part.mesh.position.clone().sub(part.basePosition).multiplyScalar(0.001)
      const planes = part.material.clippingPlanes!
      expect(planes).toHaveLength(rest[i].length)
      planes.forEach((plane, k) => {
        // A point moved with the part sees the same signed distance as the unmoved point saw before.
        const probePoint = v3(rasToScene(c.frame, [-5, 12, 0]))
        expect(plane.distanceToPoint(probePoint.clone().add(shift))).toBeCloseTo(rest[i][k].distanceToPoint(probePoint), 9)
      })
    })
    applyViewState(p, c, defaults())
  })

  it('picks a moved tumour, and its hit maps back to the unmoved geometry', () => {
    applyViewState(p, c, exploded(1))
    const o = offsetsAt(1).assets.tumor_ncr
    const ncr = tumorAssets(c.manifest).find((t) => t.id === 'tumor_ncr')!
    const target: Vec3 = [ncr.centroid_ras[0] + o[0], ncr.centroid_ras[1] + o[1], ncr.centroid_ras[2] + o[2]]
    const from = v3(rasToScene(c.frame, [target[0], target[1] + 200, target[2]]))
    const ray = new Raycaster(from, v3(rasToScene(c.frame, target)).sub(from).normalize())
    const hit = pickTumor(ray, p)!
    expect(hit.assetId).toBe('tumor_ncr')
    const ras = sceneToRas(c.frame, hit.point.toArray() as Vec3)
    const back = [ras[0] - o[0], ras[1] - o[1], ras[2] - o[2]]
    for (let a = 0; a < 3; a++) {
      expect(back[a]).toBeGreaterThanOrEqual(ncr.bbox_ras[0][a] - 1.5)
      expect(back[a]).toBeLessThanOrEqual(ncr.bbox_ras[1][a] + 1.5)
    }
    applyViewState(p, c, exploded(0))
  })

  it('keeps isClippedAway working on a moved mesh: the cut travels with the part', () => {
    const o = offsetsAt(1).assets.tumor_ncr
    const ncr = tumorAssets(c.manifest).find((t) => t.id === 'tumor_ncr')!
    const cutaway = { plane: 'coronal' as const, rasMm: ncr.centroid_ras[1] }
    applyViewState(p, c, exploded(1, { cutaway }))
    const centre: Vec3 = [ncr.centroid_ras[0] + o[0], ncr.centroid_ras[1] + o[1], ncr.centroid_ras[2] + o[2]]
    const mesh = meshOf('tumor_ncr').mesh
    // Own-frame centroid is on the plane: just in front kept, just behind (further +y) clipped.
    expect(isClippedAway(mesh, v3(rasToScene(c.frame, [centre[0], centre[1] - 3, centre[2]])))).toBe(false)
    expect(isClippedAway(mesh, v3(rasToScene(c.frame, [centre[0], centre[1] + 3, centre[2]])))).toBe(true)
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
