import { type FormEvent, useState } from 'react'
import { sendText, toggleVoice, voiceSupported } from '../agent'
import { type AgentState, type ToolLogEntry, type TranscriptEntry, useViewer, viewerStore } from '../state/store'

const LINK_TEXT: Record<AgentState['link'], string> = {
  online: 'Agent online',
  connecting: 'Connecting…',
  offline: 'Agent offline · retrying',
  unavailable: 'Agent unavailable',
}

const ROLE_TEXT: Record<TranscriptEntry['role'], string> = { user: 'You', agent: 'Jarvis', error: 'Error' }

export function AgentConsole() {
  const log = useViewer((s) => s.toolLog)
  const agent = useViewer((s) => s.agent)
  const transcript = useViewer((s) => s.transcript)
  return <AgentConsoleView agent={agent} transcript={transcript} log={log} canListen={voiceSupported()} />
}

export interface AgentConsoleViewProps {
  agent: AgentState
  transcript: TranscriptEntry[]
  log: ToolLogEntry[]
  canListen: boolean
}

/** The console without the store, so tests can render each state. */
export function AgentConsoleView({ agent, transcript, log, canListen }: AgentConsoleViewProps) {
  const [draft, setDraft] = useState('')
  const online = agent.link === 'online'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (sendText(draft)) setDraft('')
  }

  return (
    <section className="panel console" aria-label="Agent console">
      <div className="ph">
        <span>Jarvis · Orchestrator</span>
        <span className="chip" title={agent.detail ?? undefined}>
          <i className={online ? 'dot ok' : agent.link === 'unavailable' ? 'dot bad' : 'dot'} />
          {LINK_TEXT[agent.link]}
        </span>
      </div>
      <ol className="transcript" aria-live="polite" aria-label="Conversation">
        {transcript.map((t) => (
          <li key={t.id} className={`turn ${t.role}`}>
            <span className="k">{ROLE_TEXT[t.role]}</span>
            <span>{t.text}</span>
          </li>
        ))}
        {agent.busy && <li className="turn agent muted">Thinking…</li>}
      </ol>
      <form className="ask" onSubmit={submit}>
        <input
          type="text"
          aria-label="Ask Jarvis"
          placeholder={canListen ? 'Type or press V to speak' : 'Type a request'}
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!online || !draft.trim()}>
          Send
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={agent.listening}
          disabled={!online || !canListen}
          title={canListen ? 'Voice input (V)' : 'Speech recognition is not available in this browser'}
          onClick={toggleVoice}
        >
          {agent.listening ? 'Listening…' : 'Mic'}
        </button>
      </form>
      <label className="pad small row">
        <input
          type="checkbox"
          checked={agent.speakReplies}
          onChange={(e) => viewerStore.getState().setAgent({ speakReplies: e.target.checked })}
        />
        Speak replies
      </label>
      {log.length === 0 ? (
        <p className="pad muted">Tool calls from the agent, controls, keyboard and gestures appear here.</p>
      ) : (
        <ol className="tool-log" aria-label="Tool calls">
          {log
            .map((e, i) => (
              <li key={`${e.id}:${i}`} className={e.ok ? '' : 'fail'}>
                <div className="row">
                  <span className="tool">{e.name}</span>
                  <span className="k">{e.source}</span>
                </div>
                <div className="log-text">{e.ok ? e.text : `error: ${e.text}`}</div>
              </li>
            ))
            .reverse()}
        </ol>
      )}
      <p className="pad muted small">Mouse, keyboard and gestures work without the agent.</p>
    </section>
  )
}
