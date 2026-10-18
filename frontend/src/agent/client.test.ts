import { describe, expect, it, vi } from 'vitest'
import { createViewerStore } from '../state/store'
import { fsFetch } from '../test/fixtures'
import { NOT_CONNECTED, type Transport, startAgentClient } from './client'
import type { ConnectionHandlers } from './connection'
import type { ClientMessage } from './protocol'

async function setup(fetchFn: typeof fetch = fsFetch()) {
  const store = createViewerStore({ fetchFn })
  await store.getState().loadIndex()
  await store.getState().loadCase('synth_001')
  const sent: ClientMessage[] = []
  let on!: ConnectionHandlers
  let open = false
  const transport: Transport = {
    start: vi.fn(),
    stop: vi.fn(),
    send: (m) => {
      if (!open) return false
      sent.push(m)
      return true
    },
  }
  const speak = vi.fn()
  const client = startAgentClient(
    store,
    (handlers) => {
      on = handlers
      return transport
    },
    speak,
  )
  const connect = (state: 'ready' | 'unavailable' = 'ready', detail: string | null = null) => {
    on.link('connecting')
    open = true
    on.link('open')
    on.message({ type: 'status', state, detail })
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { store, sent, on: () => on, transport, speak, client, connect, flush }
}

describe('startAgentClient', () => {
  it('starts the transport and sends the current case when the socket opens', async () => {
    const h = await setup()
    expect(h.transport.start).toHaveBeenCalledOnce()
    expect(h.store.getState().agent.link).toBe('offline')
    h.connect()
    expect(h.sent[0]).toEqual({ type: 'case', case_id: 'synth_001', provenance: 'synthetic' })
    expect(h.store.getState().agent.link).toBe('online')
  })

  it('shows the server reason when the agent is unavailable', async () => {
    const h = await setup()
    h.connect('unavailable', 'MODEL_PROVIDER is not set')
    expect(h.store.getState().agent).toMatchObject({ link: 'unavailable', detail: 'MODEL_PROVIDER is not set' })
  })

  it('runs a forwarded tool call against the store and returns the result', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'tool_call', id: 'srv-1', name: 'set_explode', args: { value: 0.5 } })
    await h.flush()
    expect(h.store.getState().explode).toBe(0.5)
    expect(h.sent.at(-1)).toEqual({ type: 'tool_result', id: 'srv-1', ok: true, result: { value: 0.5 } })
    expect(h.store.getState().toolLog.at(-1)).toMatchObject({ name: 'set_explode', source: 'agent', ok: true })
  })

  it('returns browser-side validation errors to the server', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'tool_call', id: 'srv-2', name: 'set_opacity', args: { asset_id: 'nope', value: 1 } })
    await h.flush()
    const last = h.sent.at(-1)
    expect(last).toMatchObject({ type: 'tool_result', id: 'srv-2', ok: false })
  })

  it('records replies and errors, speaks replies unless muted, and tracks busy', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'busy', busy: true })
    expect(h.store.getState().agent.busy).toBe(true)
    h.on().message({ type: 'reply', turn_id: 't1', text: 'Enhancing tumour is 13.0 mL.' })
    expect(h.speak).toHaveBeenCalledWith('Enhancing tumour is 13.0 mL.')
    h.store.getState().setAgent({ speakReplies: false })
    h.on().message({ type: 'reply', turn_id: 't2', text: 'Done.' })
    h.on().message({ type: 'error', turn_id: 't3', message: 'agent failed: quota' })
    expect(h.speak).toHaveBeenCalledOnce()
    expect(h.store.getState().transcript.map((e) => [e.role, e.text])).toEqual([
      ['agent', 'Enhancing tumour is 13.0 mL.'],
      ['agent', 'Done.'],
      ['error', 'agent failed: quota'],
    ])
  })

  it('sends user turns only while online', async () => {
    const h = await setup()
    expect(h.client.sendUser('hello')).toBe(false)
    expect(h.store.getState().transcript.at(-1)).toMatchObject({ role: 'error', text: NOT_CONNECTED })
    h.connect()
    expect(h.client.sendUser('   ')).toBe(false)
    expect(h.client.sendUser('  hide the left hemisphere ')).toBe(true)
    expect(h.sent.at(-1)).toMatchObject({ type: 'user', text: 'hide the left hemisphere' })
    expect(h.store.getState().transcript.at(-1)).toMatchObject({ role: 'user', text: 'hide the left hemisphere' })
  })

  it('goes offline and clears busy when the socket closes', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'busy', busy: true })
    h.on().link('closed')
    expect(h.store.getState().agent).toMatchObject({ link: 'offline', busy: false })
  })

  it('tells the server when the case changes, and stop unsubscribes', async () => {
    const h = await setup()
    h.connect()
    expect(h.sent.filter((m) => m.type === 'case')).toHaveLength(1)
    await h.store.getState().loadCase('brats_001', 'ground-truth')
    expect(h.sent.filter((m) => m.type === 'case').at(-1)).toEqual({
      type: 'case',
      case_id: 'brats_001',
      provenance: 'ground-truth',
    })
    expect(h.sent.filter((m) => m.type === 'case')).toHaveLength(2)
    h.client.stop()
    expect(h.transport.stop).toHaveBeenCalledOnce()
    await h.store.getState().loadCase('synth_001')
    expect(h.sent.filter((m) => m.type === 'case')).toHaveLength(2)
  })

  it('sends one case message when the same case is loaded again, and resends after a reconnect', async () => {
    const h = await setup()
    h.connect()
    await h.store.getState().loadCase('synth_001')
    await h.store.getState().loadCase('synth_001')
    expect(h.sent.filter((m) => m.type === 'case')).toHaveLength(1)
    h.on().link('closed')
    h.connect()
    expect(h.sent.filter((m) => m.type === 'case')).toHaveLength(2)
  })

  it('answers an unknown tool with exactly one failed tool_result', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'tool_call', id: 'srv-9', name: 'launch_missiles', args: {} })
    await h.flush()
    const results = h.sent.filter((m) => m.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 'srv-9', ok: false })
  })

  it('answers a tool that throws with exactly one failed tool_result', async () => {
    const h = await setup()
    h.connect()
    const state = h.store.getState()
    vi.spyOn(state, 'setExplode').mockImplementation(() => {
      throw new Error('boom')
    })
    h.on().message({ type: 'tool_call', id: 'srv-10', name: 'set_explode', args: { value: 1 } })
    await h.flush()
    const results = h.sent.filter((m) => m.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 'srv-10', ok: false, error: expect.stringContaining('boom') })
  })

  it('shows the busy error in the transcript and leaves the busy flag alone', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'busy', busy: true })
    h.on().message({ type: 'error', turn_id: 't9', message: 'busy: a turn is already running' })
    expect(h.store.getState().transcript.at(-1)).toMatchObject({
      role: 'error',
      text: 'busy: a turn is already running',
    })
    expect(h.store.getState().agent.busy).toBe(true)
  })

  it('drops a tool result that completes after the socket was replaced', async () => {
    let armed = false
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const base = fsFetch()
    const h = await setup((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (armed && String(input).includes('mask_u8')) await gate
      return base(input, init)
    }) as typeof fetch)
    h.connect()
    armed = true
    h.on().message({ type: 'tool_call', id: 'srv-old', name: 'load_case', args: { case_id: 'synth_001' } })
    h.on().link('closed')
    h.connect()
    release()
    await vi.waitFor(() => expect(h.store.getState().toolLog.some((e) => e.name === 'load_case')).toBe(true))
    await h.flush()
    expect(h.sent.filter((m) => m.type === 'tool_result')).toEqual([])
  })

  it('still answers a tool call that completes on the same connection', async () => {
    const h = await setup()
    h.connect()
    h.on().message({ type: 'tool_call', id: 'srv-ok', name: 'set_explode', args: { value: 1 } })
    await h.flush()
    expect(h.sent.filter((m) => m.type === 'tool_result')).toHaveLength(1)
  })
})
