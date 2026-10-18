import { type CaseFrame, rasToVoxel, voxelToRas } from './affine'
import type { TumorAsset, Vec3 } from './manifest'
import {
  type Axis,
  AXIS_DIM,
  RAS_DIM,
  type Volume,
  extractSlice,
  slicePixelToVoxel,
  sliceShape,
  voxelToSlicePixel,
} from './volume'

export type RGB = [number, number, number]

export interface SliceImage {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Grey FLAIR; a mask pixel whose label is in `outline` and differs from a 4-neighbour is drawn in colour. */
export function renderSlice(flair: Volume, mask: Volume, axis: Axis, index: number, outline: Map<number, RGB>): SliceImage {
  const { width, height } = sliceShape(flair.dims, axis)
  const grey = extractSlice(flair, axis, index)
  const labels = extractSlice(mask, axis, index)
  const rgba = new Uint8ClampedArray(width * height * 4)
  const at = (col: number, row: number) =>
    col < 0 || row < 0 || col >= width || row >= height ? -1 : labels[row * width + col]
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const p = row * width + col
      const label = labels[p]
      const color = label > 0 ? outline.get(label) : undefined
      const edge =
        color !== undefined &&
        (at(col - 1, row) !== label || at(col + 1, row) !== label || at(col, row - 1) !== label || at(col, row + 1) !== label)
      const [r, g, b] = edge && color ? color : [grey[p], grey[p], grey[p]]
      rgba[p * 4] = r
      rgba[p * 4 + 1] = g
      rgba[p * 4 + 2] = b
      rgba[p * 4 + 3] = 255
    }
  return { width, height, rgba }
}

export function outlineColors(tumors: TumorAsset[], visible: Record<string, boolean>): Map<number, RGB> {
  return new Map(tumors.filter((t) => visible[t.id] !== false).map((t) => [t.label, hexToRgb(t.color)]))
}

/** Fractional slice pixel and slice index of a RAS point (for the crosshair). */
export function markerToSlicePixel(f: CaseFrame, axis: Axis, ras: Vec3): { col: number; row: number; index: number } {
  return voxelToSlicePixel(f.dims, axis, rasToVoxel(f, ras))
}

export function slicePointToRas(f: CaseFrame, axis: Axis, index: number, col: number, row: number): Vec3 {
  return voxelToRas(f, slicePixelToVoxel(f.dims, axis, index, col, row))
}

/** RAS coordinate (mm) the slice holds constant, measured at the slice's first voxel. */
export function sliceRasMm(f: CaseFrame, axis: Axis, index: number): number {
  const v: Vec3 = [0, 0, 0]
  v[AXIS_DIM[axis]] = index
  return voxelToRas(f, v)[RAS_DIM[axis]]
}
