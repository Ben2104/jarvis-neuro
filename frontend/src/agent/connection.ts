import { type ClientMessage, type ServerMessage, parseServerMessage } from './protocol'

export type LinkEvent = 'connecting' | 'open' | 'closed'

/** The part of WebSocket the connection uses, so tests can pass a fake. */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export interface ConnectionDeps {
  open(url: string): SocketLike
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

export interface ConnectionHandlers {
  message(msg: ServerMessage): void
  link(event: LinkEvent): void
}

const OPEN = 1
export const BACKOFF_BASE_MS = 500
export const BACKOFF_MAX_MS = 10_000

/** Reconnect delay after `attempt` failed tries: 0.5 s, 1 s, 2 s ... capped at 10 s (spec §7). */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
}

export function browserDeps(): ConnectionDeps {
  return {
    // WebSocket's handlers take typed events; the connection only sets them, so the narrower interface is safe.
    open: (url) => new WebSocket(url) as unknown as SocketLike,
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

/** One WebSocket to the agent server that reconnects with backoff until stopped. */
export class AgentConnection {
  private socket: SocketLike | null = null
  private attempt = 0
  private timer: unknown = null
  private stopped = true

  constructor(
    private readonly url: string,
    private readonly on: ConnectionHandlers,
    private readonly deps: ConnectionDeps = browserDeps(),
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.deps.cancel(this.timer)
    this.timer = null
    const s = this.socket
    this.socket = null
    if (s) {
      // Detach first so a late event from this socket cannot reach the handlers.
      s.onopen = s.onmessage = s.onclose = s.onerror = null
      s.close()
    }
    this.on.link('closed')
  }

  /** False when there is no open socket; the message is dropped, not queued. */
  send(msg: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  private connect(): void {
    this.on.link('connecting')
    let s: SocketLike
    try {
      s = this.deps.open(this.url)
    } catch (e) {
      // An invalid URL throws here, before any event. The viewer must keep working, so retry like a failed connect.
      console.warn('[agent] could not open the socket:', e instanceof Error ? e.message : String(e))
      this.on.link('closed')
      this.scheduleReconnect()
      return
    }
    this.socket = s
    const live = () => this.socket === s && !this.stopped
    s.onopen = () => {
      if (!live()) return
      this.attempt = 0
      this.on.link('open')
    }
    s.onmessage = (e) => {
      if (!live()) return
      const msg = parseServerMessage(e.data)
      if (msg) this.on.message(msg)
      else console.warn('[agent] ignored a malformed server message')
    }
    s.onerror = () => {} // a close event always follows
    s.onclose = () => {
      if (!live()) return
      this.socket = null
      this.on.link('closed')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.timer = this.deps.schedule(() => {
      this.timer = null
      this.connect()
    }, backoffMs(this.attempt++))
  }
}
