/**
 * Radians per NDC unit of hand travel. Mouse dragging in camera-controls is
 * rotate(-2π·Δx/height, -2π·Δy/height) with Δy pointing down; NDC spans 2 units and points up,
 * so the hand equivalent is rotate(-dx·π, +dy·π).
 */
export const ROTATE_GAIN = Math.PI

export interface GrabState {
  grabbing: boolean
}

/** A pinch grabs the brain only when the reticle was on it; a pinch elsewhere never rotates. */
export const onPinchStart = (onBrain: boolean): GrabState => ({ grabbing: onBrain })

export const onPinchEnd = (): GrabState => ({ grabbing: false })

/** The [azimuth, polar] camera rotation for one drag event, or null when nothing is grabbed. */
export function dragToRotate(g: GrabState, dx: number, dy: number): [number, number] | null {
  return g.grabbing ? [-dx * ROTATE_GAIN, dy * ROTATE_GAIN] : null
}
