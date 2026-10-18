/** Web Speech API wrappers (spec §5). lib.dom has no SpeechRecognition types, so the parts used are declared here. */

export interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

export interface RecognitionEventLike {
  readonly results: ArrayLike<RecognitionResultLike>
}

export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type RecognitionCtor = new () => RecognitionLike

export function recognitionCtor(g: object = globalThis): RecognitionCtor | null {
  const w = g as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** The final transcript of a recognition event, or '' if nothing final yet. */
export function finalText(e: RecognitionEventLike): string {
  let text = ''
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i]
    if (r.isFinal) text += r[0].transcript
  }
  return text.trim()
}

export function speechErrorText(code: string): string | null {
  if (code === 'aborted' || code === 'no-speech') return null
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone blocked; type instead.'
  return `Speech recognition failed (${code}); type instead.`
}

export interface ListenerHandlers {
  text(text: string): void
  listening(on: boolean): void
  error(message: string): void
}

export interface Listener {
  start(): void
  /** Ends the utterance; a result already heard is still delivered. */
  stop(): void
  /** Drops the recognition at once and ignores anything it reports later. */
  abort(): void
}

/** Single-shot listener: one utterance per start(), final result only. */
export function createListener(ctor: RecognitionCtor, on: ListenerHandlers, lang = 'en-US'): Listener {
  let rec: RecognitionLike | null = null
  return {
    start() {
      if (rec) return
      const r = new ctor()
      rec = r
      r.lang = lang
      r.continuous = false
      r.interimResults = false
      r.maxAlternatives = 1
      r.onresult = (e) => {
        if (rec !== r) return
        const text = finalText(e)
        if (text) on.text(text)
      }
      r.onerror = (e) => {
        if (rec !== r) return
        const message = speechErrorText(e.error)
        if (message) on.error(message)
      }
      r.onend = () => {
        if (rec !== r) return
        rec = null
        on.listening(false)
      }
      try {
        r.start()
        on.listening(true)
      } catch (e) {
        rec = null
        on.error(`Speech recognition failed (${e instanceof Error ? e.message : String(e)}); type instead.`)
      }
    },
    stop() {
      rec?.stop()
    },
    abort() {
      const r = rec
      if (!r) return
      rec = null
      r.onresult = r.onerror = r.onend = null
      r.abort()
      on.listening(false)
    },
  }
}

export interface SynthLike {
  cancel(): void
  speak(u: unknown): void
}

/** Speaks `text`, cutting off any reply still being read out. */
export function speak(text: string, synth: SynthLike, Utterance: new (text: string) => unknown): void {
  synth.cancel()
  synth.speak(new Utterance(text))
}

/** Stops any reply still being read out. Safe where speechSynthesis does not exist. */
export function cancelSpeech(synth: Pick<SynthLike, 'cancel'> | undefined = browserSynth()): void {
  synth?.cancel()
}

function browserSynth(): SynthLike | undefined {
  return typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis
}
