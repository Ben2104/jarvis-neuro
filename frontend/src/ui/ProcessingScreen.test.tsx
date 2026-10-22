import { expect, it } from 'vitest'
import type { Study } from '../lib/studies'
import { rowsFor } from './ProcessingScreen'

const base: Study = {
  study_id: 'a1b2c3d4e5f6',
  status: 'running',
  step: 'segment',
  steps: {
    read: { state: 'done', seconds: 0.4 },
    volume: { state: 'done', dims: [240, 240, 155], spacing_mm: [1, 1, 1] },
    segment: { state: 'running' },
    measure: { state: 'pending' },
  },
  case_id: null,
  error: null,
}

it('maps a running study to row states and details', () => {
  expect(rowsFor(base)).toEqual([
    { key: 'read', label: 'Read file', state: 'done', detail: '0.4 s' },
    { key: 'volume', label: 'Build 3D volume', state: 'done', detail: '240 × 240 × 155 · 1.00 × 1.00 × 1.00 mm' },
    { key: 'segment', label: 'Segment tumor', state: 'running', detail: 'SegResNet' },
    { key: 'measure', label: 'Measure volume & location', state: 'pending', detail: '' },
  ])
})

it('shows the error on the failed row', () => {
  const failed: Study = {
    ...base,
    status: 'failed',
    steps: { ...base.steps, segment: { state: 'failed' } },
    error: 'segmentation service unreachable at http://localhost:8001',
  }
  expect(rowsFor(failed)[2]).toEqual({
    key: 'segment',
    label: 'Segment tumor',
    state: 'failed',
    detail: 'segmentation service unreachable at http://localhost:8001',
  })
})

it('shows every row pending before the first poll', () => {
  expect(rowsFor(null).map((r) => r.state)).toEqual(['pending', 'pending', 'pending', 'pending'])
})
