import type { Manifest, Vec3 } from './manifest'

/** 4x4 matrix, 16 numbers, row-major (same layout as manifest.vox2ras / ras2gl). */
export type Mat4 = number[]
export type Dims = [number, number, number]

/** Manifest geometry is in millimetres; the scene is in metres. */
export const SCENE_SCALE = 0.001

export interface CaseFrame {
  dims: Dims
  vox2ras: Mat4
  ras2vox: Mat4
  ras2gl: Mat4
  gl2ras: Mat4
}

export function invert4(m: Mat4): Mat4 {
  // Gauss-Jordan with partial pivoting on [m | I].
  const a = Array.from({ length: 4 }, (_, r) => [
    ...m.slice(r * 4, r * 4 + 4),
    ...[0, 1, 2, 3].map((c) => (c === r ? 1 : 0)),
  ])
  for (let col = 0; col < 4; col++) {
    let pivot = col
    for (let r = col + 1; r < 4; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('matrix is singular')
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const p = a[col][col]
    for (let c = 0; c < 8; c++) a[col][c] /= p
    for (let r = 0; r < 4; r++) {
      if (r === col) continue
      const f = a[r][col]
      if (f !== 0) for (let c = 0; c < 8; c++) a[r][c] -= f * a[col][c]
    }
  }
  return a.flatMap((row) => row.slice(4))
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]
  return out
}

export function applyAffine(m: Mat4, p: Vec3): Vec3 {
  return [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as Vec3
}

/** Rotation/scale part only (for directions). */
export function applyLinear(m: Mat4, v: Vec3): Vec3 {
  return [0, 1, 2].map((r) => m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2]) as Vec3
}

export function makeFrame(m: Pick<Manifest, 'dims' | 'vox2ras' | 'ras2gl'>): CaseFrame {
  return {
    dims: [...m.dims] as Dims,
    vox2ras: [...m.vox2ras],
    ras2vox: invert4(m.vox2ras),
    ras2gl: [...m.ras2gl],
    gl2ras: invert4(m.ras2gl),
  }
}

export function voxelToRas(f: CaseFrame, v: Vec3): Vec3 {
  return applyAffine(f.vox2ras, v)
}

export function rasToVoxel(f: CaseFrame, ras: Vec3): Vec3 {
  return applyAffine(f.ras2vox, ras)
}

export function rasToVoxelIndex(f: CaseFrame, ras: Vec3): Vec3 | null {
  const v = rasToVoxel(f, ras).map(Math.round) as Vec3
  return v.every((x, i) => x >= 0 && x < f.dims[i]) ? v : null
}

export function rasToScene(f: CaseFrame, ras: Vec3): Vec3 {
  return applyAffine(f.ras2gl, ras).map((x) => x * SCENE_SCALE) as Vec3
}

export function sceneToRas(f: CaseFrame, p: Vec3): Vec3 {
  return applyAffine(f.gl2ras, p.map((x) => x / SCENE_SCALE) as Vec3)
}

export function voxelSpacing(f: CaseFrame): Vec3 {
  return [0, 1, 2].map((c) => Math.hypot(f.vox2ras[c], f.vox2ras[4 + c], f.vox2ras[8 + c])) as Vec3
}

export function rasExtent(f: CaseFrame): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const i of [0, f.dims[0] - 1])
    for (const j of [0, f.dims[1] - 1])
      for (const k of [0, f.dims[2] - 1]) {
        const p = voxelToRas(f, [i, j, k])
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], p[a])
          max[a] = Math.max(max[a], p[a])
        }
      }
  return { min, max }
}
