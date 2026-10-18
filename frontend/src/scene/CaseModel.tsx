import type { ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import type { LoadedCase } from '../lib/loadCase'
import { useViewer, viewerStore } from '../state/store'
import { isClippedAway } from './picking'
import { prepareCase } from './prepare'
import { applyViewState } from './viewState'

const assetIdOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.object.userData.assetId as string | undefined) ?? null

export function CaseModel({ loaded }: { loaded: LoadedCase }) {
  const prepared = useMemo(() => prepareCase(loaded), [loaded])
  const opacity = useViewer((s) => s.opacity)
  const visible = useViewer((s) => s.visible)
  const cutaway = useViewer((s) => s.cutaway)
  const hemisphere = useViewer((s) => s.hemisphere)
  const hovered = useViewer((s) => s.hovered)
  const selected = useViewer((s) => s.selected)

  useLayoutEffect(() => {
    applyViewState(prepared, loaded, { opacity, visible, cutaway, hemisphere, hovered, selected })
  }, [prepared, loaded, opacity, visible, cutaway, hemisphere, hovered, selected])

  // brain_surface has raycast disabled, so these only ever see tumour meshes. A hit on the
  // clipped-away side is ignored without stopPropagation, so r3f offers the event to the next hit.
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (isClippedAway(e.object, e.point)) return
    e.stopPropagation()
    viewerStore.getState().hover(assetIdOf(e))
  }
  const onPointerOut = () => viewerStore.getState().hover(null)
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (isClippedAway(e.object, e.point)) return
    e.stopPropagation()
    viewerStore.getState().select(assetIdOf(e))
  }

  return <primitive object={prepared.root} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick} />
}
