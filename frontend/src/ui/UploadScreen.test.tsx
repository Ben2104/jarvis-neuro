import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { UploadView, isComplete } from './UploadScreen'

const noop = () => {}
const file = (name: string) => new File(['x'], name)
const render = (slots: Parameters<typeof UploadView>[0]['slots'], error: string | null = null, busy = false) =>
  renderToStaticMarkup(
    <UploadView slots={slots} error={error} busy={busy} onFiles={noop} onSlot={noop} onSubmit={noop} onSample={noop} />,
  )

it('lists the four sequences and disables analyse until all are set', () => {
  const html = render({ t1c: file('a_t1ce.nii.gz') })
  for (const label of ['T1 contrast (T1c)', 'T1', 'T2', 'FLAIR']) expect(html).toContain(label)
  expect(html).toContain('a_t1ce.nii.gz')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Analyze scan<\/button>/)
})

it('shows unsupported formats as disabled', () => {
  const html = render({})
  for (const label of ['DICOM', 'ZIP', '2D slices']) expect(html).toContain(label)
  expect(html).toContain('not in this build')
})

it('shows the rejection reason inline', () => {
  expect(render({}, 't2: affine does not match t1c')).toContain('t2: affine does not match t1c')
})

it('isComplete needs all four', () => {
  const four = { t1c: file('a'), t1: file('b'), t2: file('c'), flair: file('d') }
  expect(isComplete(four)).toBe(true)
  expect(isComplete({ ...four, t2: undefined })).toBe(false)
})
