import type { NdcPoint } from './bus'
import { getWebcamFeed } from './webcamStream'

/**
 * Maps a point in the camera frame (NDC over the whole video) to NDC over the viewport when the video is
 * drawn with `object-fit: cover`. The crop pushes points on the cropped axis beyond ±1; they stay unclamped.
 */
export function coverNdc([x, y]: NdcPoint, videoW: number, videoH: number, viewW: number, viewH: number): NdcPoint {
  if (!(videoW > 0 && videoH > 0 && viewW > 0 && viewH > 0)) return [x, y]
  const scale = Math.max(viewW / videoW, viewH / videoH)
  return [(x * videoW * scale) / viewW, (y * videoH * scale) / viewH]
}

/** Hand-pointer NDC as the user sees it over the webcam backdrop; unchanged when there is no backdrop. */
export function viewNdc(ndc: NdcPoint, viewW: number, viewH: number): NdcPoint {
  const { stream, width, height } = getWebcamFeed()
  return stream ? coverNdc(ndc, width, height, viewW, viewH) : ndc
}
