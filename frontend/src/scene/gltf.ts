import type { Object3D } from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Served from public/draco/ (copied by scripts/vendor.mjs). */
export const DRACO_PATH = '/draco/'

let loader: GLTFLoader | null = null

function getLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH))
  return loader
}

export async function parseGlb(buffer: ArrayBuffer): Promise<Object3D> {
  const gltf = await getLoader().parseAsync(buffer, '')
  return gltf.scene
}
