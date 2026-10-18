import { type Manifest, type Vec3, hemisphereOf, tumorAssets } from './manifest'

/** Each hemisphere slides this fraction of the brain's x-width at full explode. */
export const HEMISPHERE_SHIFT = 0.35
/** Tumour sub-regions separate by this fraction of the brain's x-width per rank at full explode. */
export const TUMOR_STEP = 0.25

export interface ExplodeBox {
  min: Vec3
  max: Vec3
}

export interface ExplodeOffsets {
  /** Tumour asset id -> RAS mm offset (its own separation plus its hemisphere's). brain_surface is not here. */
  assets: Record<string, Vec3>
  left: Vec3
  right: Vec3
}

export const NO_OFFSET: Vec3 = [0, 0, 0]

// `+ 0` turns -0 into 0, so an assembled view is exactly [0, 0, 0].
const clean = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0]

/**
 * RAS-mm offsets for the explode view. Hemispheres slide apart along x; tumour sub-regions travel with
 * their hemisphere and separate radially from the brain centre, the largest (rank 0) staying put.
 */
export function explodeOffsets(manifest: Manifest, brain: ExplodeBox, amount: number): ExplodeOffsets {
  const t = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0
  const width = brain.max[0] - brain.min[0]
  const centre: Vec3 = [0, 1, 2].map((i) => (brain.min[i] + brain.max[i]) / 2) as Vec3

  const shift = t * HEMISPHERE_SHIFT * width
  const left = clean([0 - shift, 0, 0])
  const right = clean([shift, 0, 0])

  const tumors = tumorAssets(manifest)
  const byVolume = [...tumors].sort((a, b) => b.volume_ml - a.volume_ml)
  const assets: Record<string, Vec3> = {}
  for (const tumor of tumors) {
    const rank = byVolume.indexOf(tumor)
    const dir: Vec3 = [0, 1, 2].map((i) => tumor.centroid_ras[i] - centre[i]) as Vec3
    const len = Math.hypot(...dir)
    const travel = len > 0 ? (t * TUMOR_STEP * width * rank) / len : 0
    const side = hemisphereOf(tumor.centroid_ras[0], manifest.midline_x_ras)
    const carried = side === 'left' ? left : side === 'right' ? right : NO_OFFSET
    assets[tumor.id] = clean([0, 1, 2].map((i) => dir[i] * travel + carried[i]) as Vec3)
  }
  return { assets, left, right }
}

export const offsetOf = (offsets: ExplodeOffsets, assetId: string): Vec3 => offsets.assets[assetId] ?? NO_OFFSET
