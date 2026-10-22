import type { Provenance, TumorAsset, TumorId, Vec3 } from '../lib/manifest'

export const DASH = '—'

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  'ground-truth': 'Ground truth (expert labels)',
  'monai-segresnet': 'Model: MONAI SegResNet',
  synthetic: 'Synthetic test case',
}

/** Medical Segmentation Decathlon Task01 label meanings. No anatomy names. */
export const TUMOR_LABEL: Record<TumorId, string> = {
  tumor_ed: 'Edema (label 1)',
  tumor_ncr: 'Non-enhancing tumor (label 2)',
  tumor_et: 'Enhancing tumor (label 3)',
}

const missing = (v: unknown): v is null | undefined => v === null || v === undefined

export const fmtMl = (v: number | null | undefined) => (missing(v) ? DASH : `${v.toFixed(2)} mL`)
export const fmtMm = (v: number | null | undefined) => (missing(v) ? DASH : `${v.toFixed(1)} mm`)
export const fmtDice = (v: number | null | undefined) => (missing(v) ? DASH : v.toFixed(2))
export const fmtVec = (v: Vec3 | null | undefined) => (missing(v) ? DASH : `(${v.map((x) => x.toFixed(1)).join(', ')})`)

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

/** Sum of the manifest sub-region volumes; shown labelled as a sum. */
export function totalVolumeMl(tumors: TumorAsset[]): number | null {
  return tumors.length ? tumors.reduce((acc, t) => acc + t.volume_ml, 0) : null
}

/** Figma fields that need an atlas or a classifier (flow spec decision 2). */
export const ATLAS_ONLY = 'Requires atlas — not in this build'
