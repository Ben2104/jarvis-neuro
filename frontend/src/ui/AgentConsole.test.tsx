import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { AgentState, TranscriptEntry } from '../state/store'
import { AgentConsoleView, canSend } from './AgentConsole'

const agent = (patch: Partial<AgentState> = {}): AgentState => ({
  link: 'offline',
  detail: null,
  busy: false,
  speakReplies: true,
  listening: false,
  ...patch,
})

const render = (a: AgentState, transcript: TranscriptEntry[] = [], canListen = false) =>
  renderToStaticMarkup(<AgentConsoleView agent={a} transcript={transcript} log={[]} canListen={canListen} />)

it('shows the offline state with Send and Mic disabled', () => {
  const html = render(agent())
  expect(html).toContain('Agent offline · retrying')
  expect(html).toContain('<button type="submit" class="btn" disabled="">Send</button>')
  expect(html).toContain('title="Speech recognition is not available in this browser"')
  expect(html).toContain('aria-label="Ask Jarvis"')
})

it('shows why the agent is unavailable', () => {
  const html = render(agent({ link: 'unavailable', detail: 'MODEL_PROVIDER is not set' }))
  expect(html).toContain('title="MODEL_PROVIDER is not set"')
  expect(html).toContain('class="dot bad"')
  expect(html).toContain('Agent unavailable')
})

it('renders the transcript, the thinking line and a pressed mic while listening', () => {
  const html = render(
    agent({ link: 'online', busy: true, listening: true }),
    [
      { id: 'u1', role: 'user', text: 'how big is it', at: 1 },
      { id: 'a1', role: 'agent', text: 'Enhancing tumour is 13.0 mL.', at: 2 },
    ],
    true,
  )
  expect(html).toContain('class="dot ok"')
  expect(html).toContain('Agent online')
  expect(html).toContain('<span class="k">You</span><span>how big is it</span>')
  expect(html).toContain('<span class="k">Jarvis</span><span>Enhancing tumour is 13.0 mL.</span>')
  expect(html).toContain('Thinking…')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('Listening…')
})

it('allows Send only for text, online and not mid-turn', () => {
  expect(canSend(agent({ link: 'online' }), 'hide the left')).toBe(true)
  expect(canSend(agent({ link: 'online', busy: true }), 'hide the left')).toBe(false)
  expect(canSend(agent({ link: 'offline' }), 'hide the left')).toBe(false)
  expect(canSend(agent({ link: 'online' }), '   ')).toBe(false)
})

it('lists the live agents and greys the placeholders', () => {
  const html = render(agent())
  for (const name of ['Orchestrator', 'Clinical Reasoner', 'Vision', 'Spatial UI']) expect(html).toContain(name)
  expect(html.match(/class="chip placeholder"/g)).toHaveLength(2)
  expect(html).toContain('title="Placeholder — not in this build"')
})
