import { useViewer } from '../state/store'

/** Plan B shows the tool log. Plan C adds the agent transcript and the text and voice input here. */
export function AgentConsole() {
  const log = useViewer((s) => s.toolLog)
  return (
    <section className="panel console" aria-label="Agent console">
      <div className="ph">
        <span>Jarvis · Orchestrator</span>
        <span className="chip">
          <i className="dot" />
          Agent not connected
        </span>
      </div>
      {log.length === 0 ? (
        <p className="pad muted">Tool calls from the controls, keyboard and gestures appear here.</p>
      ) : (
        <ol className="tool-log" aria-live="polite">
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
