import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createViewerStore } from '../state/store'
import type { Transport } from './client'
import type { ConnectionHandlers } from './connection'
import { defaultAgentUrl, sendText, setSpeakReplies, startAgent, stopAgent, toggleVoice, voiceSupported } from '.'
import type { RecognitionLike } from './speech'

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: RecognitionLike['onresult'] = null
  onerror: RecognitionLike['onerror'] = null
  onend: RecognitionLike['onend'] = null
  stopped = false
  aborted = false
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {}
  stop() {
    this.stopped = true
    this.onend?.()
  }
  abort() {
    this.aborted = true
  }
}

function start() {
  const store = createViewerStore({ fetchFn: (async () => new Response('', { status: 404 })) as typeof fetch })
  let on!: ConnectionHandlers
  const transport: Transport = { start: vi.fn(), stop: vi.fn(), send: () => true }
  startAgent(store, 'ws://x/ws', (handlers) => {
    on = handlers
    return transport
  })
  const online = () => {
    on.link('connecting')
    on.link('open')
    on.message({ type: 'status', state: 'ready', detail: null })
  }
  return { store, on: () => on, online }
}

beforeEach(() => {
  FakeRecognition.instances = []
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
})

afterEach(() => {
  stopAgent()
  vi.unstubAllGlobals()
})

it('derives the WebSocket URL from the page origin', () => {
  expect(defaultAgentUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  expect(defaultAgentUrl({ protocol: 'https:', host: 'demo.example' })).toBe('wss://demo.example/ws')
})

it('does nothing before the agent is started', () => {
  vi.unstubAllGlobals()
  expect(sendText('hello')).toBe(false)
  expect(voiceSupported()).toBe(false)
  expect(() => toggleVoice()).not.toThrow()
})

it('does not start listening while the agent is offline, connecting or unavailable', () => {
  const h = start()
  toggleVoice()
  expect(FakeRecognition.instances).toHaveLength(0)
  h.on().link('connecting')
  toggleVoice()
  h.on().message({ type: 'status', state: 'unavailable', detail: 'no model' })
  toggleVoice()
  expect(FakeRecognition.instances).toHaveLength(0)
  expect(h.store.getState().agent.listening).toBe(false)
})

it('starts listening when online and always lets the user stop', () => {
  const h = start()
  h.online()
  toggleVoice()
  expect(FakeRecognition.instances).toHaveLength(1)
  expect(h.store.getState().agent.listening).toBe(true)
  toggleVoice()
  expect(FakeRecognition.instances[0].stopped).toBe(true)
  expect(h.store.getState().agent.listening).toBe(false)
})

it('stops listening when the link leaves online', () => {
  const h = start()
  h.online()
  toggleVoice()
  expect(h.store.getState().agent.listening).toBe(true)
  h.on().link('closed')
  expect(FakeRecognition.instances[0].aborted).toBe(true)
  expect(h.store.getState().agent.listening).toBe(false)
})

it('never starts a second recognition when the listening flag is set and the link is down', () => {
  const h = start()
  h.store.getState().setAgent({ listening: true })
  toggleVoice() // stop is always allowed; it must not start anything
  expect(FakeRecognition.instances).toHaveLength(0)
})

it('cancels speech when replies are muted, not when they are unmuted', () => {
  const store = createViewerStore({ fetchFn: (async () => new Response('', { status: 404 })) as typeof fetch })
  const cancel = vi.fn()
  setSpeakReplies(store, false, { cancel })
  expect(store.getState().agent.speakReplies).toBe(false)
  expect(cancel).toHaveBeenCalledOnce()
  setSpeakReplies(store, true, { cancel })
  expect(store.getState().agent.speakReplies).toBe(true)
  expect(cancel).toHaveBeenCalledOnce()
})
