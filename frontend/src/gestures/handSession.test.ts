import { afterEach, describe, expect, it } from 'vitest'
import { createViewerStore } from '../state/store'
import { deferred, fakeEnv, fakeLandmarker, fakeStream, settle } from '../test/camera'
import { makeHand } from '../test/hands'
import { type GestureEvent, gestureBus } from './bus'
import { toMirroredNdc } from './handDraw'
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

  describe('gesture frames', () => {
    async function track(frames: Parameters<typeof makeHand>[0][][], nowAt: (i: number) => number) {
      const store = createViewerStore()
      const events: GestureEvent[] = []
      const off = gestureBus.on((e) => events.push(e))
      let i = 0
      let clock = 0
      const lm = fakeLandmarker(() => ({ landmarks: (frames[i++] ?? []).map((spec) => makeHand(spec)) }))
      const run = fakeEnv({ createLandmarker: async () => lm, now: () => clock })
      startHandSession(store, run.env)
      await settle()
      for (let f = 0; f < frames.length; f++) {
        clock = nowAt(f)
        run.frame()
      }
      off()
      return events
    }

    it('emits the mirrored landmarks of every hand before that frame\'s gesture events', async () => {
      const specs = [[{ x: 0.3 }, { x: 0.7 }]]
      const events = await track(specs, () => 0)
      const [first] = events
      expect(first.type).toBe('landmarks')
      if (first.type !== 'landmarks') return
      expect(first.hands).toHaveLength(2)
      expect(first.hands[0]).toHaveLength(21)
      expect(first.hands[0]).toEqual(makeHand({ x: 0.3 }).map(toMirroredNdc))
    })

    it('emits an empty landmarks event when no hand is visible', async () => {
      const events = await track([[{}], []], () => 0)
      expect(events.filter((e) => e.type === 'landmarks').map((e) => e.type === 'landmarks' && e.hands.length)).toEqual([1, 0])
    })

    it('hands the reducer the env clock, so a quick pinch is a tap and a slow one is not', async () => {
      const pinch = (p: number) => [{ pinch: p }]
      const frames = [pinch(1), pinch(1), pinch(0.05), pinch(0.05), pinch(0.05), pinch(1), pinch(1)]
      const tapOf = async (stepMs: number) => {
        const events = await track(frames, (i) => i * stepMs)
        return events.find((e) => e.type === 'pinchEnd')
      }
      expect(await tapOf(20)).toMatchObject({ type: 'pinchEnd', tap: true })
      expect(await tapOf(1000)).toMatchObject({ type: 'pinchEnd', tap: false })
    })
  })
})
