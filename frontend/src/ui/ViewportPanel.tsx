import type { ReactNode } from 'react'
import { tumorAssets } from '../lib/manifest'
import { Viewer } from '../scene/Viewer'
import { useViewer } from '../state/store'
import { TUMOR_LABEL, fmtMm, fmtVec } from './format'

export function ViewportPanel({ children }: { children?: ReactNode }) {
  const current = useViewer((s) => s.current)
  const hovered = useViewer((s) => s.hovered)
  const selected = useViewer((s) => s.selected)
  const marker = useViewer((s) => s.marker)
  const cutaway = useViewer((s) => s.cutaway)
  const hemisphere = useViewer((s) => s.hemisphere)
  const brain = useViewer((s) => s.opacity.brain_surface)
  const gesturesOn = useViewer((s) => s.gesturesOn)

  const shownId = hovered ?? selected
  const tumor = current && shownId ? tumorAssets(current.manifest).find((t) => t.id === shownId) : undefined

  return (
    <section className="panel stage viewport" aria-label="3D viewport">
      <Viewer />
      <div className="overlay top-left">
        <span className="chip">3D view</span>
        {cutaway.plane !== 'none' && (
          <span className="chip mono">
            cutaway {cutaway.plane} · {fmtMm(cutaway.rasMm)}
          </span>
        )}
        {hemisphere !== 'none' && <span className="chip">{hemisphere} hemisphere hidden</span>}
      </div>
      {brain !== undefined && (
        <div className="overlay top-right">
          <span className="chip mono">brain_surface {Math.round(brain * 100)}%</span>
        </div>
      )}
      {tumor && (
        <div className="overlay hover-card">
          <div className="lbl">{hovered ? (gesturesOn ? 'Hover · pinch = select' : 'Hover') : 'Selected'}</div>
          <div className="mono">{tumor.id}</div>
          <div className="k">{TUMOR_LABEL[tumor.id]}</div>
        </div>
      )}
      {marker && (
        <div className="overlay bottom-left">
          <span className="mono">Marker · synced to MRI · RAS {fmtVec(marker)}</span>
        </div>
      )}
      {children}
    </section>
  )
}
