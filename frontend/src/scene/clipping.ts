import { Plane, Vector3 } from 'three'
import { type CaseFrame, applyLinear, rasToScene } from '../lib/affine'
import type { Vec3 } from '../lib/manifest'
import { RAS_DIM } from '../lib/volume'
import type { CutPlane, Hemisphere } from '../state/store'

/** three keeps fragments where plane.distanceToPoint(p) >= 0; `keepRas` is the RAS normal of the kept side. */
function planeKeeping(f: CaseFrame, keepRas: Vec3, pointRas: Vec3): Plane {
  const normal = new Vector3(...applyLinear(f.ras2gl, keepRas)).normalize()
  return new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(...rasToScene(f, pointRas)))
}

/** Removes everything with RAS coordinate on the plane's axis greater than rasMm. */
export function cutawayPlane(f: CaseFrame, plane: Exclude<CutPlane, 'none'>, rasMm: number): Plane {
  const keep: Vec3 = [0, 0, 0]
  const point: Vec3 = [0, 0, 0]
  keep[RAS_DIM[plane]] = -1
  point[RAS_DIM[plane]] = rasMm
  return planeKeeping(f, keep, point)
}

/** Removes the named hemisphere (left = RAS x below the midline). Applied to brain_surface only. */
export function hemispherePlane(f: CaseFrame, side: Exclude<Hemisphere, 'none'>, midlineX: number): Plane {
  return planeKeeping(f, [side === 'left' ? 1 : -1, 0, 0], [midlineX, 0, 0])
}
