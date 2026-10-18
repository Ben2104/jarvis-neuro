import { useEffect } from 'react'
import { toggleVoice } from '../agent'
import { viewerStore } from '../state/store'
import { runTools } from '../ui/controls'
import { normalizeKey, shortcutToCall } from './shortcuts'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return
      const s = viewerStore.getState()
      const key = normalizeKey(e.key)
      if (key === 'g') {
        s.setGesturesOn(!s.gesturesOn)
        return
      }
      if (key === 'v') {
        toggleVoice()
        return
      }
      const req = shortcutToCall(e.key, s)
      if (!req) return
      e.preventDefault()
      void runTools(viewerStore, [req], 'keyboard')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
