import { Matrix3, type Plane, Vector3 } from 'three'
import { SCENE_SCALE, applyLinear } from '../lib/affine'
import { explodeOffsets, offsetOf } from '../lib/explode'
import type { LoadedCase } from '../lib/loadCase'
import type { Vec3 } from '../lib/manifest'
import type { ViewerState } from '../state/store'
import { cutawayPlane, hemispherePlane } from './clipping'
import { BASE_EMISSIVE, HOVER_EMISSIVE, SELECTED_EMISSIVE, applyOpacity, renderOrderFor } from './materials'
import type { Part, PreparedCase } from './prepare'

export type SceneView = Pick<
  ViewerState,
  'opacity' | 'visible' | 'cutaway' | 'hemisphere' | 'explode' | 'hovered' | 'selected'
>

/** An RAS-mm offset as a world-space translation in scene metres (linear part of ras2gl only). */
export function sceneOffset(c: LoadedCase, ras: Vec3): Vector3 {
  return new Vector3(...applyLinear(c.frame.ras2gl, ras)).multiplyScalar(SCENE_SCALE)
}

export function applyViewState(p: PreparedCase, c: LoadedCase, v: SceneView): void {
  const cut = v.cutaway.plane === 'none' ? null : cutawayPlane(c.frame, v.cutaway.plane, v.cutaway.rasMm)
  const offsets = explodeOffsets(c.manifest, c.brainBoxRas, v.explode)
  const midline = c.manifest.midline_x_ras
  // A half keeps its own side of the midline; the plane that removes the other side is its hemisphere plane.
  const sidePlane = { left: hemispherePlane(c.frame, 'right', midline), right: hemispherePlane(c.frame, 'left', midline) }

  p.root.updateMatrixWorld(true)
  for (const part of p.parts) {
    const asset = c.manifest.assets.find((a) => a.id === part.assetId)!
    const opacity = v.opacity[asset.id] ?? 1
    const { mesh, material: mat } = part
    applyOpacity(mat, asset, opacity)
    mesh.renderOrder = renderOrderFor(asset, opacity)
    mesh.visible = v.visible[asset.id] !== false && opacity > 0 && part.hemisphere !== v.hemisphere

    // Planes are world-space, so each moves with its mesh and the cut stays fixed relative to the part.
    const offset = sceneOffset(c, part.hemisphere ? offsets[part.hemisphere] : offsetOf(offsets, asset.id))
    moveTo(part, offset)
    const planes = [cut, part.hemisphere ? sidePlane[part.hemisphere] : null]
      .filter((x): x is Plane => x !== null)
      .map((plane) => plane.clone().translate(offset))
    mat.clippingPlanes = planes.length > 0 ? planes : null

    if (asset.kind === 'tumor') {
      mat.emissiveIntensity =
        asset.id === v.hovered ? HOVER_EMISSIVE : asset.id === v.selected ? SELECTED_EMISSIVE : BASE_EMISSIVE
    }
  }
  p.root.updateMatrixWorld(true)
}

/** Put the mesh at its loaded position plus a world-space translation (its parent may be scaled). */
function moveTo(part: Part, worldOffset: Vector3): void {
  const parent = part.mesh.parent
  const local = worldOffset.clone()
  if (parent) local.applyMatrix3(new Matrix3().setFromMatrix4(parent.matrixWorld).invert())
  part.mesh.position.copy(part.basePosition).add(local)
}
