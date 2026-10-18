import { useSyncExternalStore } from 'react'

/** The live camera stream and its pixel size. Changes only on start/stop, never per frame. */
export interface WebcamFeed {
  stream: MediaStream | null
  width: number
  height: number
}

const NO_FEED: WebcamFeed = { stream: null, width: 0, height: 0 }
let feed = NO_FEED
const listeners = new Set<() => void>()

export const getWebcamFeed = () => feed

/** Publish the stream, or null to clear it. */
export function setWebcamFeed(next: WebcamFeed | null): void {
  const value = next ?? NO_FEED
  if (value === feed) return
  feed = value
  for (const fn of listeners) fn()
}

export function subscribeWebcamFeed(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const useWebcamFeed = () => useSyncExternalStore(subscribeWebcamFeed, getWebcamFeed)
