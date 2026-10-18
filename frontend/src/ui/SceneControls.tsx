import { useViewer, viewerStore, type CutPlane, type Hemisphere } from '../state/store'
import { CUT_PLANES, HEMISPHERES } from '../tools/schemas'
import { cutawayRange, defaultCutMm, resetViewCalls, runTools, runUi } from './controls'
import { fmtMm } from './format'

export function SceneControls() {
  const current = useViewer((s) => s.current)
  const brain = useViewer((s) => s.opacity.brain_surface ?? 0.45)
  const cutaway = useViewer((s) => s.cutaway)
  const hemisphere = useViewer((s) => s.hemisphere)
  const gesturesOn = useViewer((s) => s.gesturesOn)
  const s = viewerStore.getState()

  const gestureRow = (
    <div className="gesture-row">
      <label className="check">
        <input type="checkbox" checked={gesturesOn} onChange={(e) => s.setGesturesOn(e.target.checked)} />
        Gesture mode
      </label>
      <span>Open hand = rotate</span>
      <span>Pinch = select</span>
      <span>Two hands = zoom</span>
    </div>
  )

  if (!current) {
    return (
      <section className="panel controls" aria-label="Scene controls">
        <p className="muted">No case loaded.</p>
        {gestureRow}
      </section>
    )
  }

  const range = cutaway.plane === 'none' ? null : cutawayRange(current, cutaway.plane)

  return (
    <section className="panel controls" aria-label="Scene controls">
      <div className="controls-grid">
        <div>
          <div className="row">
            <label htmlFor="brain-opacity" className="lbl">
              Brain opacity
            </label>
            <span className="v">{Math.round(brain * 100)}%</span>
          </div>
          <input
            id="brain-opacity"
            type="range"
            min={0}
            max={100}
            value={Math.round(brain * 100)}
            onChange={(e) => s.setOpacity('brain_surface', Number(e.target.value) / 100)}
          />
        </div>
        <div className="stack">
          <div className="row">
            <label htmlFor="cut-plane" className="lbl">
              Cutaway
            </label>
            {range && <span className="v">{fmtMm(cutaway.rasMm)}</span>}
          </div>
          <select
            id="cut-plane"
            value={cutaway.plane}
            onChange={(e) => {
              const plane = e.target.value as CutPlane
              void runUi('set_cutaway', plane === 'none' ? { plane } : { plane, ras_mm: defaultCutMm(current, plane) })
            }}
          >
            {CUT_PLANES.map((p) => (
              <option key={p} value={p}>
                {p === 'none' ? 'off' : p}
              </option>
            ))}
          </select>
          {range && cutaway.plane !== 'none' && (
            <input
              type="range"
              aria-label="Cutaway position, RAS mm"
              min={range.min}
              max={range.max}
              step={1}
              value={cutaway.rasMm}
              onChange={(e) => s.setCutaway(cutaway.plane, Number(e.target.value))}
            />
          )}
        </div>
        <div className="stack">
          <label htmlFor="hemisphere" className="lbl">
            Hide hemisphere
          </label>
          <select
            id="hemisphere"
            value={hemisphere}
            onChange={(e) => void runUi('hide_hemisphere', { side: e.target.value as Hemisphere })}
          >
            {HEMISPHERES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button className="btn" onClick={() => void runTools(viewerStore, resetViewCalls(current), 'ui')}>
            Reset view
          </button>
        </div>
      </div>
      {gestureRow}
    </section>
  )
}
