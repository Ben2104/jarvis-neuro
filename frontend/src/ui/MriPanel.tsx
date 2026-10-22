import { type MouseEvent, useEffect, useMemo, useRef } from 'react'
import { type CaseFrame, voxelSpacing } from '../lib/affine'
import { tumorAssets } from '../lib/manifest'
import { markerToSlicePixel, outlineColors, renderSlice, slicePointToRas, sliceRasMm } from '../lib/slice'
import { type Axis, SLICE_EDGE_LABELS, sliceCount, sliceShape } from '../lib/volume'
import { useViewer, viewerStore } from '../state/store'
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

export function MriPanel({ axis, large = false }: { axis: Axis; large?: boolean }) {
  const current = useViewer((s) => s.current)
  const index = useViewer((s) => s.slices[axis])
  const active = useViewer((s) => s.activeAxis === axis)
  const marker = useViewer((s) => s.marker)
  const visible = useViewer((s) => s.visible)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const image = useMemo(() => {
    if (!current) return null
    const outline = outlineColors(tumorAssets(current.manifest), visible)
    return renderSlice(current.flair, current.mask, axis, index, outline)
  }, [current, axis, index, visible])

  const canvasHeight = useMemo(() => {
    if (!current) return CANVAS_WIDTH
    const { width, height } = sliceShape(current.frame.dims, axis)
    const sp = pixelSpacing(current.frame, axis)
    return Math.round((CANVAS_WIDTH * height * sp.row) / (width * sp.col))
  }, [current, axis])

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
    const px = markerToSlicePixel(current.frame, axis, marker)
    const x = ((px.col + 0.5) / image.width) * canvas.width
    const y = ((px.row + 0.5) / image.height) * canvas.height
    const onSlice = Math.round(px.index) === index
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
  }, [image, marker, current, axis, index, canvasHeight])

  if (!current || !image) {
    return (
      <section className="panel mri">
        <h2>{axis}</h2>
        <p className="muted">No case loaded.</p>
      </section>
    )
  }

  const count = sliceCount(current.frame.dims, axis)
  const edges = SLICE_EDGE_LABELS[axis]
  const s = viewerStore.getState()

  const onCanvasClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = ((e.clientX - rect.left) / rect.width) * image.width - 0.5
    const row = ((e.clientY - rect.top) / rect.height) * image.height - 0.5
    s.setSlice(axis, index)
    s.focusPoint(slicePointToRas(current.frame, axis, index, col, row))
  }

  return (
    <section className={`panel mri${large ? ' large' : ''}${active ? ' active' : ''}`} aria-label={`${axis} MRI`}>
      <div className="panel-head">
        <h2>{axis} · FLAIR</h2>
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
          aria-label={`${axis} FLAIR slice ${index + 1} of ${count}`}
        />
      </div>
      <label className="slider">
        <input
          type="range"
          min={0}
          max={count - 1}
          value={index}
          onChange={(e) => s.setSlice(axis, Number(e.target.value))}
        />
        <span className="mono">
          {index + 1} / {count} · RAS {RAS_AXIS_NAME[axis]} {fmtMm(sliceRasMm(current.frame, axis, index))}
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
