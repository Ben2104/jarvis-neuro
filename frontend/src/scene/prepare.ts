import { Group, type Material, type Mesh, type MeshStandardMaterial } from 'three'
import { SCENE_SCALE } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import { createAssetMaterial } from './materials'

export interface PreparedCase {
  root: Group
  meshes: Map<string, Mesh>
  materials: Map<string, MeshStandardMaterial>
  tumorMeshes: Mesh[]
}

const prepared = new WeakMap<LoadedCase, PreparedCase>()

/** Idempotent per LoadedCase (React StrictMode renders twice). */
export function prepareCase(c: LoadedCase): PreparedCase {
  const hit = prepared.get(c)
  if (hit) return hit

  const root = new Group()
  root.name = `case:${c.manifest.case_id}:${c.manifest.provenance}`
  root.scale.setScalar(SCENE_SCALE)
  root.add(c.scene)

  const meshes = new Map<string, Mesh>()
  const materials = new Map<string, MeshStandardMaterial>()
  const tumorMeshes: Mesh[] = []
  const replaced = new Set<Material>()

  for (const asset of c.manifest.assets) {
    const mesh = c.scene.getObjectByName(asset.node) as Mesh
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) replaced.add(m)
    const mat = createAssetMaterial(asset)
    mesh.material = mat
    mesh.userData.assetId = asset.id
    if (asset.kind === 'surface') {
      // Gesture fix 3: rays pass through the brain to the tumours inside it.
      mesh.raycast = () => {}
    } else {
      tumorMeshes.push(mesh)
    }
    meshes.set(asset.id, mesh)
    materials.set(asset.id, mat)
  }
  for (const m of replaced) m.dispose()

  const result = { root, meshes, materials, tumorMeshes }
  prepared.set(c, result)
  return result
}

export function releaseCase(c: LoadedCase): void {
  const p = prepared.get(c)
  if (!p) return
  for (const mesh of p.meshes.values()) mesh.geometry.dispose()
  for (const mat of p.materials.values()) mat.dispose()
  p.root.removeFromParent()
  p.root.clear()
  prepared.delete(c)
}
