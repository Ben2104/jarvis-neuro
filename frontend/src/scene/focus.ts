import { Box3 } from 'three'
import type { PreparedCase } from './prepare'

/** World-space bounds of one asset's mesh, for camera fitting. */
export function assetBox(p: PreparedCase, assetId: string): Box3 | null {
  const mesh = p.meshes.get(assetId)
  if (!mesh) return null
  p.root.updateMatrixWorld(true)
  return new Box3().setFromObject(mesh)
}
