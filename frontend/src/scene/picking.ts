import type { Material, Object3D, Raycaster, Vector3 } from 'three'
import type { PreparedCase } from './prepare'

export interface PickHit {
  assetId: string
  point: Vector3
}

/** True when a world-space hit point lies on the removed side of one of the object's clipping planes. */
export function isClippedAway(object: Object3D, point: Vector3): boolean {
  const planes = (object as { material?: Material }).material?.clippingPlanes ?? []
  return planes.some((plane) => plane.distanceToPoint(point) < 0)
}

/** Nearest visible tumour hit that is not clipped away. brain_surface is never hit. */
export function pickTumor(raycaster: Raycaster, p: PreparedCase): PickHit | null {
  const visible = p.tumorMeshes.filter((m) => m.visible)
  for (const hit of raycaster.intersectObjects(visible, false)) {
    if (!isClippedAway(hit.object, hit.point)) return { assetId: hit.object.userData.assetId as string, point: hit.point }
  }
  return null
}
