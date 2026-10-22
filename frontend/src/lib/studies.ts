import { z } from 'zod'

/** The agent server's study API (flow spec §2). */
export const SEQUENCES = ['t1c', 't1', 't2', 'flair'] as const
export type Sequence = (typeof SEQUENCES)[number]

const StepState = z.enum(['pending', 'running', 'done', 'failed'])
const Vec3 = z.tuple([z.number(), z.number(), z.number()])

export const StudySchema = z.object({
  study_id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  step: z.enum(['read', 'volume', 'segment', 'measure']),
  steps: z.object({
    read: z.object({ state: StepState, seconds: z.number().optional() }),
    volume: z.object({ state: StepState, dims: Vec3.optional(), spacing_mm: Vec3.optional() }),
    segment: z.object({ state: StepState }),
    measure: z.object({ state: StepState }),
  }),
  case_id: z.string().nullable(),
  error: z.string().nullable(),
})
export type Study = z.infer<typeof StudySchema>

const detailOf = (body: unknown, status: number) =>
  body && typeof body === 'object' && typeof (body as { detail?: unknown }).detail === 'string'
    ? (body as { detail: string }).detail
    : `HTTP ${status}`

export async function postStudy(files: Record<Sequence, File>, fetchFn: typeof fetch): Promise<string> {
  const body = new FormData()
  for (const s of SEQUENCES) body.append(s, files[s], files[s].name)
  const res = await fetchFn('/api/studies', { method: 'POST', body })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detailOf(data, res.status))
  return z.object({ study_id: z.string() }).parse(data).study_id
}

export async function getStudy(id: string, fetchFn: typeof fetch): Promise<Study> {
  const res = await fetchFn(`/api/studies/${encodeURIComponent(id)}`)
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detailOf(data, res.status))
  return StudySchema.parse(data)
}

// Checked in order so t1 never takes a contrast file and t2 never takes FLAIR. t2f is BraTS 2023 FLAIR.
const RULES: [Sequence, RegExp][] = [
  ['t1c', /t1(c|ce|gd|_gd|-gd|post)/],
  ['flair', /flair|t2f/],
  ['t2', /t2/],
  ['t1', /t1(?!c|ce|gd|_gd|-gd|post)/],
]

export function slotFor(filename: string): Sequence | null {
  const base = filename.split(/[\\/]/).pop()!.toLowerCase()
  return RULES.find(([, re]) => re.test(base))?.[0] ?? null
}

/** A slot is filled only when exactly one file matches it; the rest stay open for manual choice. */
export function assignFiles<T extends { name: string }>(files: T[]): Partial<Record<Sequence, T>> {
  const bySlot = new Map<Sequence, T[]>()
  for (const file of files) {
    const slot = slotFor(file.name)
    if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), file])
  }
  return Object.fromEntries([...bySlot].filter(([, fs]) => fs.length === 1).map(([s, fs]) => [s, fs[0]]))
}
