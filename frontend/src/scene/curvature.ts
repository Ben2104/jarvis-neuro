import { BufferAttribute, type BufferGeometry, Color } from 'three'

export const GYRUS_COLOR = '#E8B4AE'
export const SULCUS_COLOR = '#8E4A55'

interface Topology {
  positions: Float32Array
  normals: Float32Array
  original: Uint32Array
  offsets: Uint32Array
  neighbors: Uint32Array
}

/** Weld seams and non-indexed triangles before building unique edge adjacency. */
function topology(positions: Float32Array, normals: Float32Array, index: ArrayLike<number> | null): Topology {
  const count = positions.length / 3
  const original = new Uint32Array(count)
  const lookup = new Map<string, number>()
  const p: number[] = []
  const n: number[] = []
  for (let i = 0; i < count; i++) {
    const k = 3 * i
    const key = `${Math.round(positions[k] * 1e5)},${Math.round(positions[k + 1] * 1e5)},${Math.round(positions[k + 2] * 1e5)}`
    let id = lookup.get(key)
    if (id === undefined) {
      id = p.length / 3
      lookup.set(key, id)
      p.push(positions[k], positions[k + 1], positions[k + 2])
      n.push(0, 0, 0)
    }
    original[i] = id
    for (let a = 0; a < 3; a++) n[3 * id + a] += normals[k + a]
  }
  for (let i = 0; i < n.length; i += 3) {
    const length = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    for (let a = 0; a < 3; a++) n[i + a] /= length
  }
  const edges = Array.from({ length: p.length / 3 }, () => new Set<number>())
  const triangleCount = index?.length ?? count
  for (let i = 0; i < triangleCount; i += 3) {
    const a = original[index ? index[i] : i]
    const b = original[index ? index[i + 1] : i + 1]
    const c = original[index ? index[i + 2] : i + 2]
    if (a === b || b === c || a === c) continue
    edges[a].add(b).add(c)
    edges[b].add(a).add(c)
    edges[c].add(a).add(b)
  }
  const offsets = new Uint32Array(edges.length + 1)
  for (let i = 0; i < edges.length; i++) offsets[i + 1] = offsets[i] + edges[i].size
  const neighbors = new Uint32Array(offsets[edges.length])
  for (let i = 0; i < edges.length; i++) neighbors.set([...edges[i]], offsets[i])
  return { positions: new Float32Array(p), normals: new Float32Array(n), original, offsets, neighbors }
}

function smooth(values: Float32Array, t: Topology, dimensions: number, iterations: number): Float32Array {
  let current = values
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float32Array(current.length)
    for (let i = 0; i < t.offsets.length - 1; i++) {
      const start = t.offsets[i], end = t.offsets[i + 1]
      for (let a = 0; a < dimensions; a++) {
        let sum = 0
        for (let j = start; j < end; j++) sum += current[t.neighbors[j] * dimensions + a]
        next[i * dimensions + a] = end > start ? 0.5 * current[i * dimensions + a] + 0.5 * sum / (end - start) : current[i * dimensions + a]
      }
    }
    current = next
  }
  return current
}

function umbrella(p: Float32Array, t: Topology, iterations: number): Float32Array {
  const c = new Float32Array(p.length / 3)
  for (let i = 0; i < c.length; i++) {
    let dx = 0, dy = 0, dz = 0, length = 0
    const start = t.offsets[i], end = t.offsets[i + 1]
    for (let j = start; j < end; j++) {
      const other = 3 * t.neighbors[j]
      const x = p[other] - p[3 * i], y = p[other + 1] - p[3 * i + 1], z = p[other + 2] - p[3 * i + 2]
      dx += x; dy += y; dz += z
      length += Math.hypot(x, y, z)
    }
    // The neighbor count cancels between mean displacement and mean edge length.
    if (length > 0) c[i] = (dx * t.normals[3 * i] + dy * t.normals[3 * i + 1] + dz * t.normals[3 * i + 2]) / length
  }
  return smooth(c, t, 1, iterations)
}

function mapped(c: Float32Array): Float32Array {
  if (!c.length) return c
  const sorted = c.slice().sort()
  const percentile = (q: number) => {
    const at = q * (sorted.length - 1), lo = Math.floor(at)
    return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo)
  }
  const lo = percentile(0.05), hi = percentile(0.95)
  return hi <= lo ? new Float32Array(c.length).fill(0.5) : c.map((v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))))
}

/** Smoothed umbrella curvature before robust percentile mapping. */
export function rawConcavity(positions: Float32Array, normals: Float32Array, index: ArrayLike<number> | null, smoothIters = 3): Float32Array {
  const t = topology(positions, normals, index)
  const c = umbrella(t.positions, t, smoothIters)
  return Float32Array.from(t.original, (i) => c[i])
}

/** Per-vertex concavity in [0, 1]: deepest sulcus = 1, gyral crown = 0. */
export function concavity(positions: Float32Array, normals: Float32Array, index: ArrayLike<number> | null, smoothIters = 3): Float32Array {
  const t = topology(positions, normals, index)
  const fine = mapped(umbrella(t.positions, t, smoothIters))
  const coarse = mapped(umbrella(smooth(t.positions, t, 3, 12), t, smoothIters))
  return Float32Array.from(t.original, (i) => 0.6 * fine[i] + 0.4 * coarse[i])
}

/** Write sulcal RGB once; both hemisphere meshes share this geometry. */
export function addSulcalColors(geometry: BufferGeometry): void {
  if (geometry.userData.sulcalShaded === true) return
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal')
  const c = concavity(p.array as Float32Array, n.array as Float32Array, geometry.index?.array ?? null)
  const colors = new Float32Array(c.length * 3)
  const gyrus = new Color(GYRUS_COLOR), sulcus = new Color(SULCUS_COLOR)
  for (let i = 0; i < c.length; i++) {
    colors[3 * i] = gyrus.r + (sulcus.r - gyrus.r) * c[i]
    colors[3 * i + 1] = gyrus.g + (sulcus.g - gyrus.g) * c[i]
    colors[3 * i + 2] = gyrus.b + (sulcus.b - gyrus.b) * c[i]
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.userData.sulcalShaded = true
}
