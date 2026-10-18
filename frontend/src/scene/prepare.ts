import { Group, type Material, Mesh, type MeshStandardMaterial, type Vector3 } from 'three'
import { SCENE_SCALE } from '../lib/affine'
import type { LoadedCase } from '../lib/loadCase'
import { addSulcalColors } from './curvature'
import { createAssetMaterial } from './materials'

export type Side = 'left' | 'right'

/** One renderable mesh. brain_surface has two (one per hemisphere), every tumour one. */
export interface Part {
  assetId: string
  mesh: Mesh
  material: MeshStandardMaterial
  /** Set for the brain halves: the side of the midline this mesh is clipped to. */
  hemisphere: Side | null
  /** The mesh's position as loaded; explode offsets are added to it. */
  basePosition: Vector3
}

export interface PreparedCase {
  root: Group
  /** Each asset's primary mesh and material (for brain_surface, the left half). `parts` has them all. */
  meshes: Map<string, Mesh>
  materials: Map<string, MeshStandardMaterial>
  parts: Part[]
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
  const parts: Part[] = []
  const tumorMeshes: Mesh[] = []
  const replaced = new Set<Material>()

  const addPart = (assetId: string, mesh: Mesh, material: MeshStandardMaterial, hemisphere: Side | null) => {
    mesh.material = material
    mesh.userData.assetId = assetId
    parts.push({ assetId, mesh, material, hemisphere, basePosition: mesh.position.clone() })
  }

  for (const asset of c.manifest.assets) {
    const mesh = c.scene.getObjectByName(asset.node) as Mesh
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) replaced.add(m)
    const mat = createAssetMaterial(asset)
    if (asset.kind === 'surface') {
      addSulcalColors(mesh.geometry)
      // Two meshes share the geometry, each clipped to its side of the midline so the halves can move apart.
      // Each needs its own material: clipping planes are per material and follow the half's offset.
      addPart(asset.id, mesh, mat, 'left')
      // Gesture fix 3: rays pass through the brain to the tumours inside it.
      mesh.raycast = () => {}
      const right = new Mesh(mesh.geometry)
      right.name = `${mesh.name}:right`
      right.position.copy(mesh.position)
      right.quaternion.copy(mesh.quaternion)
      right.scale.copy(mesh.scale)
      right.raycast = () => {}
      mesh.parent?.add(right)
      addPart(asset.id, right, createAssetMaterial(asset), 'right')
    } else {
      addPart(asset.id, mesh, mat, null)
      tumorMeshes.push(mesh)
    }
    meshes.set(asset.id, mesh)
    materials.set(asset.id, mat)
  }
  for (const m of replaced) m.dispose()

  const result = { root, meshes, materials, parts, tumorMeshes }
  prepared.set(c, result)
  return result
}

export function releaseCase(c: LoadedCase): void {
  const p = prepared.get(c)
  if (!p) return
  for (const geometry of new Set(p.parts.map((x) => x.mesh.geometry))) geometry.dispose()
  for (const { material } of p.parts) material.dispose()
  p.root.removeFromParent()
  p.root.clear()
  prepared.delete(c)
}
