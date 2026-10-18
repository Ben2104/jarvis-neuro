import { z } from 'zod'
import type { Provenance } from '../lib/manifest'

/** Messages the agent server sends. Mirrors backend/src/jarvis_neuro/agent/protocol.py. */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), state: z.enum(['ready', 'unavailable']), detail: z.string().nullable() }),
  z.object({ type: z.literal('busy'), busy: z.boolean() }),
  z.object({ type: z.literal('tool_call'), id: z.string(), name: z.string(), args: z.unknown() }),
  z.object({ type: z.literal('reply'), turn_id: z.string(), text: z.string() }),
  z.object({ type: z.literal('error'), turn_id: z.string().nullable(), message: z.string() }),
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>

/** Messages the browser sends. The backend validates them with pydantic (extra keys rejected). */
export type ClientMessage =
  | { type: 'user'; turn_id: string; text: string }
  | { type: 'tool_result'; id: string; ok: true; result: unknown }
  | { type: 'tool_result'; id: string; ok: false; error: string }
  | { type: 'case'; case_id: string; provenance: Provenance }

/** A WebSocket frame to a server message, or null if it is not one. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const r = ServerMessageSchema.safeParse(json)
  return r.success ? r.data : null
}
