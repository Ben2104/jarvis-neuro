import { performance } from 'node:perf_hooks'
import { SphereGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { addSulcalColors, concavity, rawConcavity } from './curvature'
import { createAssetMaterial } from './materials'

function sphere(groove = false, width = 48, height = 32) {
  const g = new SphereGeometry(1, width, height)
  const p = g.getAttribute('position')
  if (groove) {
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i)) < 0.08) p.setXYZ(i, p.getX(i) * 0.9, p.getY(i) * 0.9, p.getZ(i) * 0.9)
    }
    g.computeVertexNormals()
  }
  return g
}

function values(g: SphereGeometry) {
  return concavity(g.getAttribute('position').array as Float32Array, g.getAttribute('normal').array as Float32Array, g.index?.array ?? null)
}

function means(g: SphereGeometry, v: Float32Array) {
  const groups: number[][] = [[], []]
  for (let i = 0; i < v.length; i++) groups[Math.abs(g.getAttribute('position').getZ(i)) < 0.08 ? 0 : 1].push(v[i])
  return groups.map((a) => a.reduce((s, x) => s + x, 0) / a.length)
}

describe('cortical concavity', () => {
  it('has uniform raw curvature on a sphere', () => {
    const g = sphere()
    const c = rawConcavity(g.getAttribute('position').array as Float32Array, g.getAttribute('normal').array as Float32Array, g.index!.array)
    expect(Math.max(...c) - Math.min(...c)).toBeLessThan(0.15)
  })

  it('makes the groove darker than the rest', () => {
    const g = sphere(true)
    const [groove, rest] = means(g, values(g))
    expect(groove).toBeGreaterThan(rest + 0.3)
  })

  it('agrees for indexed and non-indexed geometry', () => {
    const g = sphere(true)
    const ni = g.toNonIndexed() as SphereGeometry
    const indexed = values(g)
    const nonIndexed = values(ni)
    for (let i = 0; i < nonIndexed.length; i++) expect(Math.abs(nonIndexed[i] - indexed[g.index!.getX(i)])).toBeLessThan(0.05)
  })

  it('adds bounded RGB colors once', () => {
    const g = sphere(true)
    addSulcalColors(g)
    const color = g.getAttribute('color')
    expect(color.array.length).toBe(g.getAttribute('position').count * 3)
    expect([...color.array].every((x) => x >= 0 && x <= 1)).toBe(true)
    const before = Array.from(color.array)
    addSulcalColors(g)
    expect(g.getAttribute('color')).toBe(color)
    expect(Array.from(color.array)).toEqual(before)
  })

  it('uses translucent vertex colors for the cortex', () => {
    const mat = createAssetMaterial({ id: 'brain_surface', node: 'brain_surface', kind: 'surface' })
    expect(mat.vertexColors).toBe(true)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
  })

  it('handles 100k faces within the CI budget', () => {
    const g = sphere(true, 256, 196)
    const start = performance.now()
    values(g)
    const ms = performance.now() - start
    console.log(`concavity: ${g.index!.count / 3} faces, ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(1000)
  })
})
