import { SHORTCUTS } from '../tools/shortcuts'

export function ShortcutLegend() {
  return (
    <section className="panel" aria-label="Keyboard shortcuts">
      <div className="ph">
        <span>Keyboard</span>
      </div>
      <dl className="pad shortcuts">
        {SHORTCUTS.map((s) => (
          <div className="row" key={s.label}>
            <dt>
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd className="k">{s.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
