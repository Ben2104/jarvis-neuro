import { useEffect } from 'react'
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
      if (normalizeKey(e.key) === 'g') {
        s.setGesturesOn(!s.gesturesOn)
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
