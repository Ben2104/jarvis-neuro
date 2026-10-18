import type { ViewerStore } from '../state/store'
import { type AgentClient, type Transport, startAgentClient } from './client'
import { AgentConnection, type ConnectionHandlers } from './connection'
import { type Listener, type SynthLike, cancelSpeech, createListener, recognitionCtor, speak } from './speech'

/** App-wide agent client. The console and the shortcuts reach it through these functions. */
let client: AgentClient | null = null
let listener: Listener | null = null
let agentStore: ViewerStore | null = null
let unsubscribe: (() => void) | null = null

export function defaultAgentUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`
}

function speakReply(text: string) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return
  speak(text, speechSynthesis, SpeechSynthesisUtterance)
}

/** `makeTransport` is for tests; the app uses the reconnecting WebSocket. */
export function startAgent(
  store: ViewerStore,
  url: string,
  makeTransport: (on: ConnectionHandlers) => Transport = (on) => new AgentConnection(url, on),
): void {
  if (client) return
  agentStore = store
  client = startAgentClient(store, makeTransport, speakReply)
  const ctor = recognitionCtor()
  const l = ctor
    ? createListener(ctor, {
        text: (t) => void client?.sendUser(t),
        listening: (on) => store.getState().setAgent({ listening: on }),
        error: (message) => store.getState().addTranscript({ id: `mic-${Date.now()}`, role: 'error', text: message, at: Date.now() }),
      })
    : null
  listener = l
  // A dead link cannot take a voice command: drop the recognition when the agent stops being online.
  unsubscribe = store.subscribe((now, prev) => {
    if (prev.agent.link === 'online' && now.agent.link !== 'online') l?.abort()
  })
}

/** Stops the client and forgets it. The app never calls this; tests do. */
export function stopAgent(): void {
  listener?.abort()
  unsubscribe?.()
  client?.stop()
  client = listener = agentStore = unsubscribe = null
}

export function sendText(text: string): boolean {
  return client?.sendUser(text) ?? false
}

export const voiceSupported = (): boolean => recognitionCtor() !== null

/** Mute or unmute spoken replies; muting cuts off a reply that is being read out. */
export function setSpeakReplies(store: ViewerStore, on: boolean, synth?: Pick<SynthLike, 'cancel'>): void {
  store.getState().setAgent({ speakReplies: on })
  if (!on) cancelSpeech(synth)
}

/** Push-to-talk toggle for the mic button and the V key. Stopping is always allowed; starting needs an online agent. */
export function toggleVoice(): void {
  if (!listener || !agentStore) return
  const { agent } = agentStore.getState()
  if (agent.listening) listener.stop()
  else if (agent.link === 'online') listener.start()
}
