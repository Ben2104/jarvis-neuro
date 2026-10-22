import { hemisphereOf, tumorAssets } from '../lib/manifest'
import { useViewer } from '../state/store'
import { runUi } from './controls'
import { ATLAS_ONLY, DASH, PROVENANCE_LABEL, TUMOR_LABEL, fmtDice, fmtMl, fmtMm, fmtVec, totalVolumeMl } from './format'

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}

/** Every value here is read from manifest.json (spec decision 5). */
export function FindingsPanel() {
  const current = useViewer((s) => s.current)
  const visible = useViewer((s) => s.visible)
  const selected = useViewer((s) => s.selected)

  if (!current) {
    return (
      <section className="panel" aria-label="Findings">
        <div className="ph">
          <span>Findings</span>
        </div>
        <p className="pad muted">No case loaded.</p>
      </section>
    )
  }

  const m = current.manifest
  const tumors = tumorAssets(m)
  const sel = tumors.find((t) => t.id === selected)
  const dice = m.metrics.dice_vs_gt

  return (
    <section className="panel" aria-label="Findings">
      <div className="ph">
        <span>Volumetric Analysis</span>
        <span className="chip mono">manifest.json</span>
      </div>
      <div className="pad stack">
        <Row k="Case ID" v={m.case_id} />
        <Row k="Segmentation" v={PROVENANCE_LABEL[m.provenance]} />
        <hr />
        <div className="lbl">Sub-regions</div>
        {tumors.length === 0 && <p className="pad">No tumor detected</p>}
        {tumors.map((t) => (
          <div className="row" key={t.id}>
            <span className="check">
              <input
                type="checkbox"
                aria-label={`Show ${t.id}`}
                checked={visible[t.id] !== false}
                onChange={(e) => void runUi('toggle_visibility', { asset_ids: [t.id], visible: e.target.checked })}
              />
              <i className="swatch" style={{ background: t.color }} />
              <button className="link" onClick={() => void runUi('focus_region', { asset_id: t.id })}>
                {TUMOR_LABEL[t.id]}
              </button>
            </span>
            <span className="v">{fmtMl(t.volume_ml)}</span>
          </div>
        ))}
        {tumors.length > 0 && (
          <>
            <hr />
            <Row k="Sum of sub-regions" v={fmtMl(totalVolumeMl(tumors))} />
          </>
        )}
        {dice && Object.keys(dice).length > 0 ? (
          Object.entries(dice).map(([key, value]) => <Row key={key} k={`Dice vs ground truth · ${key}`} v={fmtDice(value)} />)
        ) : (
          <Row k="Dice vs ground truth" v={DASH} />
        )}
        <hr />
        <Row k="Lobe" v={ATLAS_ONLY} />
        <Row k="Tumor type" v={ATLAS_ONLY} />
        <Row k="Eloquent cortex" v={ATLAS_ONLY} />
        <hr />
        {sel ? (
          <>
            <div className="lbl">Selected · {sel.id}</div>
            <Row k="Centroid (RAS)" v={`${fmtVec(sel.centroid_ras)} mm`} />
            <Row k="Bounding box min (RAS)" v={`${fmtVec(sel.bbox_ras[0])} mm`} />
            <Row k="Bounding box max (RAS)" v={`${fmtVec(sel.bbox_ras[1])} mm`} />
            <Row k="Min. distance to brain surface" v={fmtMm(sel.min_dist_surface_mm)} />
            <Row k="Hemisphere (vs midline)" v={hemisphereOf(sel.centroid_ras[0], m.midline_x_ras)} />
          </>
        ) : (
          <p className="muted small">Click a sub-region in 3D or in the list to see its values.</p>
        )}
      </div>
    </section>
  )
}
