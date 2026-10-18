import type { Plane } from 'three'
import type { LoadedCase } from '../lib/loadCase'
import type { ViewerState } from '../state/store'
import { cutawayPlane, hemispherePlane } from './clipping'
import { BASE_EMISSIVE, HOVER_EMISSIVE, SELECTED_EMISSIVE, applyOpacity, renderOrderFor } from './materials'
import type { PreparedCase } from './prepare'

export type SceneView = Pick<ViewerState, 'opacity' | 'visible' | 'cutaway' | 'hemisphere' | 'hovered' | 'selected'>

export function applyViewState(p: PreparedCase, c: LoadedCase, v: SceneView): void {
  const cut = v.cutaway.plane === 'none' ? null : cutawayPlane(c.frame, v.cutaway.plane, v.cutaway.rasMm)
  const hemi = v.hemisphere === 'none' ? null : hemispherePlane(c.frame, v.hemisphere, c.manifest.midline_x_ras)

  for (const asset of c.manifest.assets) {
    const mesh = p.meshes.get(asset.id)!
    const mat = p.materials.get(asset.id)!
    const opacity = v.opacity[asset.id] ?? 1
    applyOpacity(mat, asset, opacity)
    mesh.renderOrder = renderOrderFor(asset, opacity)
    mesh.visible = v.visible[asset.id] !== false && opacity > 0

    const planes = [cut, asset.kind === 'surface' ? hemi : null].filter((x): x is Plane => x !== null)
    mat.clippingPlanes = planes.length > 0 ? planes : null

    if (asset.kind === 'tumor') {
      mat.emissiveIntensity =
        asset.id === v.hovered ? HOVER_EMISSIVE : asset.id === v.selected ? SELECTED_EMISSIVE : BASE_EMISSIVE
    }
  }
}
