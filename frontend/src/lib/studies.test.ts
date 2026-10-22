import { describe, expect, it } from 'vitest'
import { assignFiles, getStudy, postStudy, slotFor } from './studies'

const f = (name: string) => ({ name })

describe('filename matcher', () => {
  it.each([
    ['BraTS2021_00012_t1ce.nii.gz', 't1c'],
    ['sub-01_T1Gd.nii', 't1c'],
    ['case_t1_gd.nii.gz', 't1c'],
    ['case-t1post.nii.gz', 't1c'],
    ['BraTS-GLI-00012-000-t1c.nii.gz', 't1c'],
    ['BraTS2021_00012_t1.nii.gz', 't1'],
    ['BraTS-GLI-00012-000-t1n.nii.gz', 't1'],
    ['BraTS2021_00012_flair.nii.gz', 'flair'],
    ['BraTS-GLI-00012-000-t2f.nii.gz', 'flair'],
    ['BraTS2021_00012_t2.nii.gz', 't2'],
    ['BraTS-GLI-00012-000-t2w.nii.gz', 't2'],
    ['T2_FLAIR.nii.gz', 'flair'],
    ['notes.txt', null],
  ])('%s → %s', (name, slot) => {
    expect(slotFor(name)).toBe(slot)
  })

  it('uses the basename only', () => {
    expect(slotFor('/data/t1ce_scans/patient_flair.nii.gz')).toBe('flair')
  })

  it('assigns each slot once and leaves duplicates open', () => {
    const files = [f('a_t1ce.nii.gz'), f('a_t1.nii.gz'), f('a_t2.nii.gz'), f('b_t2.nii.gz'), f('readme.md')]
    expect(assignFiles(files)).toEqual({ t1c: files[0], t1: files[1] })
  })
})

const study = {
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

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

describe('study api', () => {
  it('posts the four files and returns the id', async () => {
    const seen: FormData[] = []
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init.body as FormData)
      return new Response(JSON.stringify({ study_id: 'a1b2c3d4e5f6' }), { status: 202 })
    }) as typeof fetch
    const file = (n: string) => new File(['x'], n)
    const id = await postStudy({ t1c: file('a.nii'), t1: file('b.nii'), t2: file('c.nii'), flair: file('d.nii') }, fetchFn)
    expect(id).toBe('a1b2c3d4e5f6')
    expect([...seen[0].keys()]).toEqual(['t1c', 't1', 't2', 'flair'])
  })

  it('surfaces the server detail on a 400', async () => {
    const fetchFn = reply(400, { detail: 't2: affine does not match t1c' }) as unknown as typeof fetch
    const file = new File(['x'], 'a.nii')
    await expect(postStudy({ t1c: file, t1: file, t2: file, flair: file }, fetchFn)).rejects.toThrow(
      't2: affine does not match t1c',
    )
  })

  it('parses a study status', async () => {
    expect(await getStudy('a1b2c3d4e5f6', reply(200, study) as unknown as typeof fetch)).toEqual(study)
  })

  it('rejects a malformed status', async () => {
    await expect(getStudy('x', reply(200, { status: 'weird' }) as unknown as typeof fetch)).rejects.toThrow()
  })
})
