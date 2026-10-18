import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const toggleVoice = vi.fn()
vi.mock('../agent', () => ({ toggleVoice: () => toggleVoice() }))

import { onShortcutKey } from './useShortcuts'

class FakeElement {
  isContentEditable = false
  constructor(public tagName: string) {}
}

const press = (key: string, target: unknown = null) =>
  onShortcutKey({
    key,
    target,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    preventDefault: () => {},
  } as unknown as KeyboardEvent)

beforeEach(() => {
  toggleVoice.mockClear()
  vi.stubGlobal('HTMLElement', FakeElement)
})

afterEach(() => vi.unstubAllGlobals())

it('V toggles voice input', () => {
  press('v')
  press('V')
  expect(toggleVoice).toHaveBeenCalledTimes(2)
})

it('V does nothing while focus is in the text box', () => {
  press('v', new FakeElement('INPUT'))
  press('v', new FakeElement('TEXTAREA'))
  expect(toggleVoice).not.toHaveBeenCalled()
})
