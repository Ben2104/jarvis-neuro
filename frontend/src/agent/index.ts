import type { ViewerStore } from '../state/store'
import { type AgentClient, startAgentClient } from './client'
import { AgentConnection } from './connection'
import { type Listener, createListener, recognitionCtor, speak } from './speech'

/** App-wide agent client. The console and the shortcuts reach it through these functions. */
let client: AgentClient | null = null
let listener: Listener | null = null
let agentStore: ViewerStore | null = null

export function defaultAgentUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`
}

function speakReply(text: string) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return
  speak(text, speechSynthesis, SpeechSynthesisUtterance)
}

export function startAgent(store: ViewerStore, url: string): void {
  if (client) return
  agentStore = store
  client = startAgentClient(store, (on) => new AgentConnection(url, on), speakReply)
  const ctor = recognitionCtor()
  listener = ctor
    ? createListener(ctor, {
        text: (t) => void client?.sendUser(t),
        listening: (on) => store.getState().setAgent({ listening: on }),
        error: (message) => store.getState().addTranscript({ id: `mic-${Date.now()}`, role: 'error', text: message, at: Date.now() }),
      })
    : null
}

export function sendText(text: string): boolean {
  return client?.sendUser(text) ?? false
}

export const voiceSupported = (): boolean => recognitionCtor() !== null

/** Push-to-talk toggle for the mic button and the V key. */
export function toggleVoice(): void {
  if (!listener || !agentStore) return
  if (agentStore.getState().agent.listening) listener.stop()
  else listener.start()
}
