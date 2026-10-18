import { describe, expect, it, vi } from 'vitest'
import {
  type RecognitionEventLike,
  type RecognitionLike,
  cancelSpeech,
  createListener,
  finalText,
  recognitionCtor,
  speak,
} from './speech'

const event = (...parts: [string, boolean][]): RecognitionEventLike => ({
  results: parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
})

class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null
  static failStart = false
  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 5
  onresult: RecognitionLike['onresult'] = null
  onerror: RecognitionLike['onerror'] = null
  onend: RecognitionLike['onend'] = null
  started = false
  aborted = false
  constructor() {
    FakeRecognition.last = this
  }
  start() {
    if (FakeRecognition.failStart) throw new Error('busy')
    this.started = true
  }
  stop() {
    this.onend?.()
  }
  abort() {
    this.aborted = true
  }
}

const handlers = () => ({ text: vi.fn(), listening: vi.fn(), error: vi.fn() })

describe('speech', () => {
  it('finds the standard or the webkit constructor', () => {
    expect(recognitionCtor({})).toBeNull()
    expect(recognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
    expect(recognitionCtor({ SpeechRecognition: FakeRecognition, webkitSpeechRecognition: class {} })).toBe(
      FakeRecognition,
    )
  })

  it('keeps final results only', () => {
    expect(finalText(event(['hide the ', true], ['left', true]))).toBe('hide the left')
    expect(finalText(event(['hide', false]))).toBe('')
  })

  it('listens for one utterance and reports the text', () => {
    const on = handlers()
    const l = createListener(FakeRecognition, on)
    l.start()
    const r = FakeRecognition.last!
    expect([r.lang, r.continuous, r.interimResults, r.maxAlternatives, r.started]).toEqual(['en-US', false, false, 1, true])
    expect(on.listening).toHaveBeenLastCalledWith(true)
    r.onresult?.(event(['explode the brain', true]))
    expect(on.text).toHaveBeenCalledWith('explode the brain')
    l.stop()
    expect(on.listening).toHaveBeenLastCalledWith(false)
  })

  it('maps a blocked microphone to a typed-input hint and ignores silence', () => {
    const on = handlers()
    createListener(FakeRecognition, on).start()
    FakeRecognition.last!.onerror?.({ error: 'no-speech' })
    expect(on.error).not.toHaveBeenCalled()
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' })
    expect(on.error).toHaveBeenCalledWith('Microphone blocked; type instead.')
  })

  it('reports a start failure instead of throwing', () => {
    const on = handlers()
    FakeRecognition.failStart = true
    createListener(FakeRecognition, on).start()
    FakeRecognition.failStart = false
    expect(on.error).toHaveBeenCalledWith('Speech recognition failed (busy); type instead.')
    expect(on.listening).not.toHaveBeenCalled()
  })

  it('cancels the current reply before speaking the next', () => {
    const calls: string[] = []
    const synth = { cancel: () => calls.push('cancel'), speak: (u: unknown) => calls.push(`speak:${(u as { t: string }).t}`) }
    speak('Done.', synth, class {
      constructor(public t: string) {}
    })
    expect(calls).toEqual(['cancel', 'speak:Done.'])
  })

  it('aborts a running recognition at once and ignores its late events', () => {
    const on = handlers()
    const l = createListener(FakeRecognition, on)
    l.start()
    const r = FakeRecognition.last!
    const late = r.onresult
    l.abort()
    expect(r.aborted).toBe(true)
    expect(on.listening).toHaveBeenLastCalledWith(false)
    late?.(event(['too late', true]))
    expect(on.text).not.toHaveBeenCalled()
    l.start() // a fresh recognition can start again
    expect(FakeRecognition.last).not.toBe(r)
  })

  it('abort without a running recognition does nothing', () => {
    const on = handlers()
    createListener(FakeRecognition, on).abort()
    expect(on.listening).not.toHaveBeenCalled()
  })

  it('cancels speech when muted, and tolerates a browser without speechSynthesis', () => {
    const cancel = vi.fn()
    cancelSpeech({ cancel })
    expect(cancel).toHaveBeenCalledOnce()
    expect(() => cancelSpeech(undefined)).not.toThrow()
  })
})
