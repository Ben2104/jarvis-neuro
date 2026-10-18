import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWebcamFeed, setWebcamFeed, subscribeWebcamFeed } from './webcamStream'

const feed = { stream: {} as MediaStream, width: 640, height: 480 }

afterEach(() => setWebcamFeed(null))

describe('webcam feed', () => {
  it('starts empty, publishes a stream and clears it', () => {
    expect(getWebcamFeed().stream).toBeNull()
    setWebcamFeed(feed)
    expect(getWebcamFeed()).toBe(feed)
    setWebcamFeed(null)
    expect(getWebcamFeed().stream).toBeNull()
  })

  it('notifies subscribers on change only', () => {
    const fn = vi.fn()
    const off = subscribeWebcamFeed(fn)
    setWebcamFeed(null)
    expect(fn).not.toHaveBeenCalled()
    setWebcamFeed(feed)
    setWebcamFeed(null)
    expect(fn).toHaveBeenCalledTimes(2)
    off()
    setWebcamFeed(feed)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
