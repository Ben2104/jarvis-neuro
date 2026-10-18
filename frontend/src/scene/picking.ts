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

/**
 * The part a ray hits: visible, not clipped away. A tumour (`userData.kind !== 'region'`) beats any region hit,
 * even a nearer one, because regions wrap the tumours; otherwise the nearest hit wins. brain_surface is never hit.
 */
export function pickPart(raycaster: Raycaster, p: PreparedCase): PickHit | null {
  const visible = p.pickMeshes.filter((m) => m.visible)
  let region: PickHit | null = null
  for (const hit of raycaster.intersectObjects(visible, false)) {
    if (isClippedAway(hit.object, hit.point)) continue
    const picked = { assetId: hit.object.userData.assetId as string, point: hit.point }
    if (hit.object.userData.kind !== 'region') return picked
    region ??= picked
  }
  return region
}
