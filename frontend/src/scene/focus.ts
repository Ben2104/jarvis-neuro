import { Box3 } from 'three'
import type { PreparedCase } from './prepare'

/** World-space bounds of one asset's meshes at their current (possibly exploded) positions, for camera fitting. */
export function assetBox(p: PreparedCase, assetId: string): Box3 | null {
  const parts = p.parts.filter((x) => x.assetId === assetId)
  if (parts.length === 0) return null
  p.root.updateMatrixWorld(true)
  const box = new Box3()
  for (const { mesh } of parts) box.union(new Box3().setFromObject(mesh))
  return box
}
