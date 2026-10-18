import { afterEach, describe, expect, it } from 'vitest'
import { createViewerStore } from '../state/store'
import { deferred, fakeEnv, fakeLandmarker, fakeStream, settle } from '../test/camera'
import { getWebcamFeed, setWebcamFeed } from './webcamStream'
import { startHandSession } from './handSession'

afterEach(() => setWebcamFeed(null))

describe('startHandSession', () => {
  it('runs to "on" and publishes the feed, then releases everything on cancel', async () => {
    const store = createViewerStore()
    const { stream, track } = fakeStream()
    const lm = fakeLandmarker()
    const { env } = fakeEnv({ getUserMedia: async () => stream, createLandmarker: async () => lm })
    const cancel = startHandSession(store, env)
    await settle()
    expect(store.getState().webcam.status).toBe('on')
    expect(getWebcamFeed().stream).toBe(stream)

    cancel()
    cancel()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(lm.close).toHaveBeenCalledTimes(1)
    expect(getWebcamFeed().stream).toBeNull()
  })

  it('reports a denied camera without an error text', async () => {
    const store = createViewerStore()
    const { env } = fakeEnv({ getUserMedia: () => Promise.reject(new DOMException('no', 'NotAllowedError')) })
    startHandSession(store, env)
    await settle()
    expect(store.getState().webcam).toEqual({ status: 'denied', hands: 0, error: null })
  })

  it('reports a missing camera API', async () => {
    const store = createViewerStore()
    startHandSession(store, fakeEnv({ getUserMedia: null }).env)
    await settle()
    expect(store.getState().webcam).toMatchObject({ status: 'unavailable', error: 'this browser has no camera API' })
  })

  describe('overlapping sessions', () => {
    it("a cancelled session resolving late does not clear the newer session's feed", async () => {
      const store = createViewerStore()
      const a = fakeStream()
      const b = fakeStream()
      const aMedia = deferred<MediaStream>()
      const cancelA = startHandSession(store, fakeEnv({ getUserMedia: () => aMedia.promise }).env)
      cancelA()
      startHandSession(store, fakeEnv({ getUserMedia: async () => b.stream }).env)
      await settle()
      expect(getWebcamFeed().stream).toBe(b.stream)

      aMedia.resolve(a.stream)
      await settle()
      expect(a.track.stop).toHaveBeenCalled()
      expect(b.track.stop).not.toHaveBeenCalled()
      expect(getWebcamFeed().stream).toBe(b.stream)
      expect(store.getState().webcam.status).toBe('on')
    })

    it("a cancelled session whose detector loads late closes it and leaves the newer feed alone", async () => {
      const store = createViewerStore()
      const a = fakeStream()
      const b = fakeStream()
      const aLandmarker = deferred<ReturnType<typeof fakeLandmarker>>()
      const lateLm = fakeLandmarker()
      const cancelA = startHandSession(
        store,
        fakeEnv({ getUserMedia: async () => a.stream, createLandmarker: () => aLandmarker.promise }).env,
      )
      await settle()
      cancelA()
      startHandSession(store, fakeEnv({ getUserMedia: async () => b.stream }).env)
      await settle()
      expect(getWebcamFeed().stream).toBe(b.stream)

      aLandmarker.resolve(lateLm)
      await settle()
      expect(lateLm.close).toHaveBeenCalledTimes(1)
      expect(getWebcamFeed().stream).toBe(b.stream)
      expect(b.track.stop).not.toHaveBeenCalled()
    })
  })

  describe('detector failure', () => {
    it('stops the tracks, closes the landmarker and keeps the unavailable status', async () => {
      const store = createViewerStore()
      const { stream, track } = fakeStream()
      const lm = fakeLandmarker(() => {
        throw new Error('context lost')
      })
      const run = fakeEnv({ getUserMedia: async () => stream, createLandmarker: async () => lm })
      startHandSession(store, run.env)
      await settle()
      expect(store.getState().webcam.status).toBe('on')

      run.frame()
      expect(store.getState().webcam).toEqual({
        status: 'unavailable',
        hands: 0,
        error: 'hand tracking stopped: context lost',
      })
      expect(track.stop).toHaveBeenCalledTimes(1)
      expect(lm.close).toHaveBeenCalledTimes(1)
      expect(getWebcamFeed().stream).toBeNull()
      expect(track.listeners.size).toBe(0)
      expect(run.hasFrame()).toBe(false)
    })

    it('survives a landmarker whose close() also throws', async () => {
      const store = createViewerStore()
      const { stream, track } = fakeStream()
      const lm = fakeLandmarker(() => {
        throw new Error('boom')
      })
      lm.close.mockImplementation(() => {
        throw new Error('already gone')
      })
      const run = fakeEnv({ getUserMedia: async () => stream, createLandmarker: async () => lm })
      startHandSession(store, run.env)
      await settle()
      run.frame()
      expect(track.stop).toHaveBeenCalled()
      expect(store.getState().webcam.status).toBe('unavailable')
    })
  })

  describe('camera track ending', () => {
    it('during detector init: never reaches "on", releases the late detector and the tracks', async () => {
      const store = createViewerStore()
      const { stream, track } = fakeStream()
      const init = deferred<ReturnType<typeof fakeLandmarker>>()
      const lateLm = fakeLandmarker()
      startHandSession(store, fakeEnv({ getUserMedia: async () => stream, createLandmarker: () => init.promise }).env)
      await settle()
      expect(store.getState().webcam.status).toBe('starting')

      track.end()
      expect(store.getState().webcam).toMatchObject({ status: 'unavailable', error: 'camera stopped' })
      init.resolve(lateLm)
      await settle()
      expect(store.getState().webcam.status).toBe('unavailable')
      expect(track.stop).toHaveBeenCalled()
      expect(lateLm.close).toHaveBeenCalledTimes(1)
      expect(getWebcamFeed().stream).toBeNull()
    })

    it('while tracking: releases the camera and the detector', async () => {
      const store = createViewerStore()
      const { stream, track } = fakeStream()
      const lm = fakeLandmarker()
      const run = fakeEnv({ getUserMedia: async () => stream, createLandmarker: async () => lm })
      startHandSession(store, run.env)
      await settle()
      track.end()
      expect(store.getState().webcam).toMatchObject({ status: 'unavailable', error: 'camera stopped' })
      expect(track.stop).toHaveBeenCalledTimes(1)
      expect(lm.close).toHaveBeenCalledTimes(1)
      expect(run.hasFrame()).toBe(false)
    })
  })
})
