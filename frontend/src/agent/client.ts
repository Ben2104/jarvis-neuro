import type { ViewerStore } from '../state/store'
import { executeTool, newCallId } from '../tools/execute'
import type { ConnectionHandlers } from './connection'
import type { ClientMessage, ServerMessage } from './protocol'

/** What the client needs from AgentConnection; tests pass a fake. */
export interface Transport {
  start(): void
  stop(): void
  send(msg: ClientMessage): boolean
}

export interface AgentClient {
  /** Sends one user turn. False (and an error line in the transcript) when the agent is not online. */
  sendUser(text: string): boolean
  stop(): void
}

export const NOT_CONNECTED = 'The agent is not connected. Mouse, keyboard and gestures still work.'

/** Wires the agent socket to the viewer store: runs forwarded tool calls, keeps the server's case in sync, records the transcript. */
export function startAgentClient(
  store: ViewerStore,
  makeTransport: (on: ConnectionHandlers) => Transport,
  speak: (text: string) => void,
): AgentClient {
  const s = () => store.getState()
  const note = (role: 'user' | 'agent' | 'error', text: string) =>
    s().addTranscript({ id: newCallId(role), role, text, at: Date.now() })

  const sendCase = () => {
    const c = s().current
    if (c) transport.send({ type: 'case', case_id: c.manifest.case_id, provenance: c.manifest.provenance })
  }

  const onMessage = async (msg: ServerMessage) => {
    switch (msg.type) {
      case 'status':
        s().setAgent({ link: msg.state === 'ready' ? 'online' : 'unavailable', detail: msg.detail })
        return
      case 'busy':
        s().setAgent({ busy: msg.busy })
        return
      case 'tool_call': {
        const result = await executeTool(store, { id: msg.id, name: msg.name, args: msg.args }, 'agent')
        transport.send({ type: 'tool_result', ...result })
        return
      }
      case 'reply':
        note('agent', msg.text)
        if (s().agent.speakReplies) speak(msg.text)
        return
      case 'error':
        note('error', msg.message)
        return
    }
  }

  const transport = makeTransport({
    message: (msg) => void onMessage(msg),
    link(event) {
      if (event === 'closed') s().setAgent({ link: 'offline', busy: false })
      else s().setAgent({ link: 'connecting' })
      if (event === 'open') sendCase()
    },
  })

  const unsubscribe = store.subscribe((now, prev) => {
    if (now.current !== prev.current) sendCase()
  })
  transport.start()

  return {
    sendUser(raw) {
      const text = raw.trim()
      if (!text) return false
      if (s().agent.link !== 'online') {
        note('error', NOT_CONNECTED)
        return false
      }
      note('user', text)
      if (transport.send({ type: 'user', turn_id: newCallId('turn'), text: text.slice(0, 2000) })) return true
      note('error', NOT_CONNECTED)
      return false
    },
    stop() {
      unsubscribe()
      transport.stop()
    },
  }
}
