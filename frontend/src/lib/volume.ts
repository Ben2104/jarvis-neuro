import type { Dims } from './affine'
import type { Vec3 } from './manifest'

export const AXES = ['axial', 'coronal', 'sagittal'] as const
export type Axis = (typeof AXES)[number]

/** Voxel dimension the slice index walks (volumes are canonical: i→R, j→A, k→S). */
export const AXIS_DIM: Record<Axis, 0 | 1 | 2> = { sagittal: 0, coronal: 1, axial: 2 }
/** RAS component a slice of this axis holds constant. */
export const RAS_DIM: Record<Axis, 0 | 1 | 2> = { sagittal: 0, coronal: 1, axial: 2 }

export class Volume {
  readonly dims: Dims
  readonly data: Uint8Array

  constructor(dims: Dims, data: Uint8Array) {
    const expected = dims[0] * dims[1] * dims[2]
    if (data.length !== expected) {
      throw new RangeError(`volume has ${data.length} bytes, expected ${expected} (${dims.join('x')})`)
    }
    this.dims = dims
    this.data = data
  }

  offset(i: number, j: number, k: number): number {
    return (i * this.dims[1] + j) * this.dims[2] + k
  }

  get(i: number, j: number, k: number): number {
    return this.data[this.offset(i, j, k)]
  }
}

export function sliceShape(dims: Dims, axis: Axis): { width: number; height: number } {
  if (axis === 'axial') return { width: dims[0], height: dims[1] }
  if (axis === 'coronal') return { width: dims[0], height: dims[2] }
  return { width: dims[1], height: dims[2] }
}

export function sliceCount(dims: Dims, axis: Axis): number {
  return dims[AXIS_DIM[axis]]
}

// Radiological display. Change these two functions (and SLICE_EDGE_LABELS) together.
export function slicePixelToVoxel(dims: Dims, axis: Axis, index: number, col: number, row: number): Vec3 {
  if (axis === 'axial') return [dims[0] - 1 - col, dims[1] - 1 - row, index]
  if (axis === 'coronal') return [dims[0] - 1 - col, index, dims[2] - 1 - row]
  return [index, dims[1] - 1 - col, dims[2] - 1 - row]
}

export function voxelToSlicePixel(dims: Dims, axis: Axis, v: Vec3): { col: number; row: number; index: number } {
  if (axis === 'axial') return { col: dims[0] - 1 - v[0], row: dims[1] - 1 - v[1], index: v[2] }
  if (axis === 'coronal') return { col: dims[0] - 1 - v[0], row: dims[2] - 1 - v[2], index: v[1] }
  return { col: dims[1] - 1 - v[1], row: dims[2] - 1 - v[2], index: v[0] }
}

export const SLICE_EDGE_LABELS: Record<Axis, { left: string; right: string; top: string; bottom: string }> = {
  axial: { left: 'R', right: 'L', top: 'A', bottom: 'P' },
  coronal: { left: 'R', right: 'L', top: 'S', bottom: 'I' },
  sagittal: { left: 'A', right: 'P', top: 'S', bottom: 'I' },
}

export function extractSlice(vol: Volume, axis: Axis, index: number): Uint8Array {
  const count = sliceCount(vol.dims, axis)
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${axis} slice ${index} out of range 0..${count - 1}`)
  }
  const { width, height } = sliceShape(vol.dims, axis)
  const out = new Uint8Array(width * height)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const [i, j, k] = slicePixelToVoxel(vol.dims, axis, index, col, row)
      out[row * width + col] = vol.get(i, j, k)
    }
  return out
}
