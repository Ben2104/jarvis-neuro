import { type MouseEvent, useEffect, useMemo, useRef } from 'react'
import { type CaseFrame, voxelSpacing } from '../lib/affine'
import { tumorAssets } from '../lib/manifest'
import { markerToSlicePixel, outlineColors, renderSlice, slicePointToRas, sliceRasMm } from '../lib/slice'
import { AXES, type Axis, SLICE_EDGE_LABELS, sliceCount, sliceShape } from '../lib/volume'
import { sliceIndexThrough, useViewer, viewerStore } from '../state/store'
import { TUMOR_LABEL, fmtMm } from './format'

const CANVAS_WIDTH = 512
const RAS_AXIS_NAME: Record<Axis, string> = { axial: 'z', coronal: 'y', sagittal: 'x' }

/** mm per slice pixel along screen columns and rows. */
function pixelSpacing(f: CaseFrame, axis: Axis): { col: number; row: number } {
  const [si, sj, sk] = voxelSpacing(f)
  if (axis === 'axial') return { col: si, row: sj }
  if (axis === 'coronal') return { col: si, row: sk }
  return { col: sj, row: sk }
}

export function MriPanel() {
  const current = useViewer((s) => s.current)
  const slice = useViewer((s) => s.slice)
  const marker = useViewer((s) => s.marker)
  const visible = useViewer((s) => s.visible)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const image = useMemo(() => {
    if (!current) return null
    const outline = outlineColors(tumorAssets(current.manifest), visible)
    return renderSlice(current.flair, current.mask, slice.axis, slice.index, outline)
  }, [current, slice, visible])

  const canvasHeight = useMemo(() => {
    if (!current) return CANVAS_WIDTH
    const { width, height } = sliceShape(current.frame.dims, slice.axis)
    const sp = pixelSpacing(current.frame, slice.axis)
    return Math.round((CANVAS_WIDTH * height * sp.row) / (width * sp.col))
  }, [current, slice.axis])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !image || !current) return
    const off = document.createElement('canvas')
    off.width = image.width
    off.height = image.height
    off.getContext('2d')!.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height)

    if (!marker) return
    const px = markerToSlicePixel(current.frame, slice.axis, marker)
    const x = ((px.col + 0.5) / image.width) * canvas.width
    const y = ((px.row + 0.5) / image.height) * canvas.height
    const onSlice = Math.round(px.index) === slice.index
    ctx.strokeStyle = '#5BC0CE'
    ctx.globalAlpha = onSlice ? 0.95 : 0.5
    ctx.lineWidth = 2
    ctx.setLineDash(onSlice ? [] : [6, 6])
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, canvas.height)
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.setLineDash([])
  }, [image, marker, current, slice, canvasHeight])

  if (!current || !image) {
    return (
      <section className="panel mri">
        <h2>MRI · FLAIR</h2>
        <p className="muted">No case loaded.</p>
      </section>
    )
  }

  const count = sliceCount(current.frame.dims, slice.axis)
  const edges = SLICE_EDGE_LABELS[slice.axis]
  const s = viewerStore.getState()

  const pickAxis = (axis: Axis) => {
    const index = marker ? sliceIndexThrough(current.frame, axis, marker) : Math.floor(sliceCount(current.frame.dims, axis) / 2)
    s.setSlice(axis, index)
  }

  const onCanvasClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = ((e.clientX - rect.left) / rect.width) * image.width - 0.5
    const row = ((e.clientY - rect.top) / rect.height) * image.height - 0.5
    s.setMarker(slicePointToRas(current.frame, slice.axis, slice.index, col, row))
  }

  return (
    <section className="panel mri">
      <div className="panel-head">
        <h2>MRI · FLAIR</h2>
        <div className="tabs" role="tablist">
          {AXES.map((axis) => (
            <button
              key={axis}
              role="tab"
              aria-selected={axis === slice.axis}
              className={axis === slice.axis ? 'tab active' : 'tab'}
              onClick={() => pickAxis(axis)}
            >
              {axis}
            </button>
          ))}
        </div>
      </div>
      <div className="slice-frame">
        <span className="edge edge-left">{edges.left}</span>
        <span className="edge edge-right">{edges.right}</span>
        <span className="edge edge-top">{edges.top}</span>
        <span className="edge edge-bottom">{edges.bottom}</span>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={canvasHeight}
          onClick={onCanvasClick}
          aria-label={`${slice.axis} FLAIR slice ${slice.index + 1} of ${count}`}
        />
      </div>
      <label className="slider">
        <input
          type="range"
          min={0}
          max={count - 1}
          value={slice.index}
          onChange={(e) => s.setSlice(slice.axis, Number(e.target.value))}
        />
        <span className="mono">
          {slice.index + 1} / {count} · RAS {RAS_AXIS_NAME[slice.axis]} {fmtMm(sliceRasMm(current.frame, slice.axis, slice.index))}
        </span>
      </label>
      <ul className="legend">
        {tumorAssets(current.manifest).map((t) => (
          <li key={t.id} className={visible[t.id] === false ? 'off' : ''}>
            <i style={{ background: t.color }} /> {TUMOR_LABEL[t.id]}
          </li>
        ))}
      </ul>
    </section>
  )
}
