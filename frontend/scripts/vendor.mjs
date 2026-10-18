// Copies runtime assets that must be served same-origin (Draco decoder, MediaPipe wasm)
// into public/, and downloads the hand landmark model once. public/draco and
// public/mediapipe are gitignored.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

cpSync(join(root, 'node_modules/three/examples/jsm/libs/draco/gltf'), join(pub, 'draco'), { recursive: true })
cpSync(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(pub, 'mediapipe/wasm'), { recursive: true })

const model = join(pub, 'mediapipe/hand_landmarker.task')
if (!existsSync(model)) {
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    mkdirSync(dirname(model), { recursive: true })
    writeFileSync(model, Buffer.from(await res.arrayBuffer()))
    console.log('vendor: downloaded hand_landmarker.task')
  } catch (err) {
    console.warn(`vendor: could not download ${MODEL_URL} (${err.message}); gestures stay unavailable until it exists`)
  }
}
console.log('vendor: draco decoder and mediapipe wasm copied into public/')
