import { afterEach, describe, expect, it } from 'vitest'
import { coverNdc, viewNdc } from './cover'
import { setWebcamFeed } from './webcamStream'

describe('coverNdc', () => {
  it('is the identity when the viewport has the video aspect', () => {
    expect(coverNdc([0.3, -0.7], 640, 480, 800, 600)).toEqual([0.3, -0.7])
    expect(coverNdc([0.3, -0.7], 640, 480, 320, 240)).toEqual([0.3, -0.7])
  })

  it('stretches y when a wider viewport crops top and bottom', () => {
    const [x, y] = coverNdc([0.5, 0.25], 640, 480, 1280, 480)
    expect(x).toBeCloseTo(0.5, 12)
    expect(y).toBeCloseTo(0.5, 12)
    // The top edge of the video is cropped away: it lands beyond the viewport.
    expect(coverNdc([0, 1], 640, 480, 1280, 480)[1]).toBeCloseTo(2, 12)
  })

  it('stretches x when a taller viewport crops the sides', () => {
    const [x, y] = coverNdc([0.25, -0.5], 640, 480, 300, 600)
    expect(x).toBeCloseTo(0.25 * (640 * 1.25) / 300, 12)
    expect(y).toBeCloseTo(-0.5, 12)
  })

  it('keeps the centre at the centre', () => {
    expect(coverNdc([0, 0], 640, 480, 300, 600)).toEqual([0, 0])
  })

  it('passes the point through when a size is unknown', () => {
    expect(coverNdc([0.2, 0.4], 0, 0, 800, 600)).toEqual([0.2, 0.4])
    expect(coverNdc([0.2, 0.4], 640, 480, 0, 0)).toEqual([0.2, 0.4])
  })
})

describe('viewNdc', () => {
  afterEach(() => setWebcamFeed(null))

  it('leaves the point alone without a backdrop and maps it with one', () => {
    expect(viewNdc([0.5, 0.25], 1280, 480)).toEqual([0.5, 0.25])
    setWebcamFeed({ stream: {} as MediaStream, width: 640, height: 480 })
    expect(viewNdc([0.5, 0.25], 1280, 480)[1]).toBeCloseTo(0.5, 12)
  })
})
