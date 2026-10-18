import { describe, expect, it } from 'vitest'
import { readSynthManifestJson } from '../test/fixtures'
import { makeFrame } from './affine'
import { ManifestSchema, tumorAssets } from './manifest'
import { hexToRgb, markerToSlicePixel, outlineColors, renderSlice, slicePointToRas, sliceRasMm } from './slice'
import { Volume } from './volume'

const manifest = ManifestSchema.parse(readSynthManifestJson())
const frame = makeFrame(manifest)

/** 5x5x1 volumes: flair constant 40, mask label 3 in a 3x3 block at i, j in 1..3. */
function block() {
  const flair = new Volume([5, 5, 1], new Uint8Array(25).fill(40))
  const mask = new Volume([5, 5, 1], new Uint8Array(25))
  for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) mask.data[mask.offset(i, j, 0)] = 3
  return { flair, mask }
}

function pixel(img: { width: number; rgba: Uint8ClampedArray }, col: number, row: number) {
  const o = (row * img.width + col) * 4
  return [...img.rgba.slice(o, o + 4)]
}

describe('renderSlice', () => {
  it('draws grey FLAIR and outlines only label boundaries', () => {
    const { flair, mask } = block()
    const img = renderSlice(flair, mask, 'axial', 0, new Map([[3, [255, 0, 0]]]))
    expect(img.width).toBe(5)
    expect(img.height).toBe(5)
    let red = 0
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 5; col++) if (pixel(img, col, row)[0] === 255) red++
    expect(red).toBe(8)
    expect(pixel(img, 2, 2)).toEqual([40, 40, 40, 255])
    expect(pixel(img, 0, 0)).toEqual([40, 40, 40, 255])
    expect(pixel(img, 1, 1)).toEqual([255, 0, 0, 255])
  })

  it('does not outline labels missing from the colour map', () => {
    const { flair, mask } = block()
    const img = renderSlice(flair, mask, 'axial', 0, new Map())
    expect(img.rgba.every((v, i) => (i % 4 === 3 ? v === 255 : v === 40))).toBe(true)
  })
})

describe('outlineColors and hexToRgb', () => {
  it('maps visible tumour labels to manifest colours', () => {
    expect(hexToRgb('#E8705A')).toEqual([232, 112, 90])
    const colors = outlineColors(tumorAssets(manifest), { tumor_ed: false })
    expect([...colors.keys()].sort()).toEqual([2, 3])
    expect(colors.get(3)).toEqual([232, 112, 90])
  })
})

describe('crosshair mapping', () => {
  it('places the tumour centroid at axial slice 25, column 36, row 25', () => {
    const px = markerToSlicePixel(frame, 'axial', [-24, 18, 3])
    expect(px.col).toBeCloseTo(36, 9)
    expect(px.row).toBeCloseTo(25, 9)
    expect(px.index).toBeCloseTo(25, 9)
  })

  it('maps a slice click back to RAS', () => {
    const ras = slicePointToRas(frame, 'axial', 25, 36, 25)
    ras.forEach((x, i) => expect(x).toBeCloseTo([-24, 18, 3][i], 9))
  })

  it('reports the RAS millimetre position of a slice', () => {
    expect(sliceRasMm(frame, 'axial', 25)).toBeCloseTo(3, 9)
    expect(sliceRasMm(frame, 'coronal', 38)).toBeCloseTo(18, 9)
    expect(sliceRasMm(frame, 'sagittal', 19)).toBeCloseTo(-24, 9)
  })
})
