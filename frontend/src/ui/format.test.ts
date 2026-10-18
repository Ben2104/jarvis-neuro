import { describe, expect, it } from 'vitest'
import { ManifestSchema, tumorAssets } from '../lib/manifest'
import { readSynthManifestJson } from '../test/fixtures'
import { DASH, TUMOR_LABEL, fmtDice, fmtMl, fmtMm, fmtVec, totalVolumeMl } from './format'

const tumors = tumorAssets(ManifestSchema.parse(readSynthManifestJson()))

describe('format', () => {
  it('formats manifest values without inventing any', () => {
    expect(fmtMl(13.014)).toBe('13.01 mL')
    expect(fmtMm(28.30194339616981)).toBe('28.3 mm')
    expect(fmtVec([-24, 18, 3])).toBe('(-24.0, 18.0, 3.0)')
    expect(fmtDice(0.8125)).toBe('0.81')
  })

  it('renders missing values as a dash', () => {
    expect(fmtMl(null)).toBe(DASH)
    expect(fmtMm(undefined)).toBe(DASH)
    expect(fmtVec(null)).toBe(DASH)
    expect(fmtDice(null)).toBe(DASH)
    expect(totalVolumeMl([])).toBeNull()
  })

  it('sums sub-region volumes', () => {
    expect(fmtMl(totalVolumeMl(tumors))).toBe('38.31 mL')
  })

  it('names labels by the MSD convention', () => {
    expect(TUMOR_LABEL).toEqual({
      tumor_ed: 'Edema (label 1)',
      tumor_ncr: 'Non-enhancing tumor (label 2)',
      tumor_et: 'Enhancing tumor (label 3)',
    })
  })
})
