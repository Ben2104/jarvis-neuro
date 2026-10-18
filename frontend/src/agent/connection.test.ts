import { describe, expect, it, vi } from 'vitest'
import { AgentConnection, BACKOFF_MAX_MS, type ConnectionDeps, type SocketLike, backoffMs } from './connection'
import { parseServerMessage } from './protocol'

class FakeSocket implements SocketLike {
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
}

function harness() {
  const sockets: FakeSocket[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const deps: ConnectionDeps = {
    open: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    schedule: (fn, ms) => timers.push({ fn, ms }),
    cancel: vi.fn(),
  }
  const links: string[] = []
  const messages: unknown[] = []
  const conn = new AgentConnection('ws://x/ws', { message: (m) => messages.push(m), link: (l) => links.push(l) }, deps)
  return { conn, sockets, timers, links, messages, deps }
}

describe('backoffMs', () => {
  it('doubles from 500 ms and caps at 10 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 8000, BACKOFF_MAX_MS, BACKOFF_MAX_MS])
  })
})

describe('parseServerMessage', () => {
  it('accepts the server message types and rejects anything else', () => {
    expect(parseServerMessage('{"type":"busy","busy":true}')).toEqual({ type: 'busy', busy: true })
    expect(parseServerMessage('{"type":"tool_call","id":"srv-1","name":"set_explode","args":{"value":1}}')).toEqual({
      type: 'tool_call',
      id: 'srv-1',
      name: 'set_explode',
      args: { value: 1 },
    })
    expect(parseServerMessage('{"type":"reply","turn_id":"t"}')).toBeNull()
    expect(parseServerMessage('not json')).toBeNull()
    expect(parseServerMessage(new ArrayBuffer(2))).toBeNull()
  })
})

describe('AgentConnection', () => {
  it('reports connecting then open, and sends JSON only while open', () => {
    const h = harness()
    h.conn.start()
    expect(h.links).toEqual(['connecting'])
    expect(h.conn.send({ type: 'user', turn_id: 't1', text: 'hi' })).toBe(false)
    h.sockets[0].open()
    expect(h.links).toEqual(['connecting', 'open'])
    expect(h.conn.send({ type: 'user', turn_id: 't1', text: 'hi' })).toBe(true)
    expect(JSON.parse(h.sockets[0].sent[0])).toEqual({ type: 'user', turn_id: 't1', text: 'hi' })
  })

  it('passes valid server messages on and drops malformed ones', () => {
    const h = harness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.conn.start()
    h.sockets[0].open()
    h.sockets[0].onmessage?.({ data: '{"type":"busy","busy":false}' })
    h.sockets[0].onmessage?.({ data: '{"type":"nope"}' })
    expect(h.messages).toEqual([{ type: 'busy', busy: false }])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('reconnects with growing backoff and resets it after a successful open', () => {
    const h = harness()
    h.conn.start()
    h.sockets[0].drop()
    expect(h.timers.map((t) => t.ms)).toEqual([500])
    h.timers[0].fn()
    h.sockets[1].drop()
    expect(h.timers.map((t) => t.ms)).toEqual([500, 1000])
    h.timers[1].fn()
    h.sockets[2].open()
    h.sockets[2].drop()
    expect(h.timers.map((t) => t.ms)).toEqual([500, 1000, 500])
    expect(h.links).toEqual(['connecting', 'closed', 'connecting', 'closed', 'connecting', 'open', 'closed'])
  })

  it('stop closes the socket, cancels a pending retry and never reconnects', () => {
    const h = harness()
    h.conn.start()
    h.sockets[0].drop()
    h.conn.stop()
    expect(h.deps.cancel).toHaveBeenCalledOnce()
    const h2 = harness()
    h2.conn.start()
    h2.sockets[0].open()
    h2.conn.stop()
    expect(h2.sockets[0].closed).toBe(true)
    h2.sockets[0].drop() // the late close event of the stopped socket
    expect(h2.timers).toEqual([])
    expect(h2.conn.send({ type: 'user', turn_id: 't', text: 'x' })).toBe(false)
  })
})
