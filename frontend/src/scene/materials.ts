import { Color, DoubleSide, FrontSide, MeshStandardMaterial } from 'three'
import type { Asset } from '../lib/manifest'

export const RIM_COLOR = '#FFE4DC'
export const BASE_EMISSIVE = 0.08
export const HOVER_EMISSIVE = 0.55
export const SELECTED_EMISSIVE = 0.3

/** View-dependent rim (spec §6 "Fresnel rim"): brighter and more opaque where the surface turns away. */
export function addFresnelRim(mat: MeshStandardMaterial, color = RIM_COLOR, power = 3.0): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new Color(color) }
    shader.uniforms.uRimPower = { value: power }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;')
      .replace(
        '#include <opaque_fragment>',
        [
          'float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), uRimPower);',
          'outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.0, 0.86, 0.84), 0.25);',
          'outgoingLight += uRimColor * rim;',
          'diffuseColor.a = clamp(diffuseColor.a + rim * 0.35, 0.0, 1.0);',
          '#include <opaque_fragment>',
        ].join('\n'),
      )
  }
  mat.customProgramCacheKey = () => 'cortex-rim'
}

export function createAssetMaterial(asset: Asset): MeshStandardMaterial {
  if (asset.kind === 'surface') {
    const mat = new MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.55,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: FrontSide,
    })
    addFresnelRim(mat)
    return mat
  }
  return new MeshStandardMaterial({
    color: asset.color,
    emissive: asset.color,
    emissiveIntensity: BASE_EMISSIVE,
    roughness: 0.45,
    metalness: 0,
    side: DoubleSide,
  })
}

export function applyOpacity(mat: MeshStandardMaterial, asset: Asset, opacity: number): void {
  const transparent = asset.kind === 'surface' || opacity < 1
  if (mat.transparent !== transparent) {
    mat.transparent = transparent
    mat.needsUpdate = true
  }
  mat.opacity = opacity
  mat.depthWrite = !transparent
}

/** Opaque tumours first, translucent tumours next, brain_surface last (spec §6). */
export function renderOrderFor(asset: Asset, opacity: number): number {
  if (asset.kind === 'surface') return 2
  return opacity < 1 ? 1 : 0
}
