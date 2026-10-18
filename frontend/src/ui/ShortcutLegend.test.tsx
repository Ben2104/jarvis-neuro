import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ShortcutLegend } from './ShortcutLegend'

it('renders the keyboard fallback legend', () => {
  const html = renderToStaticMarkup(<ShortcutLegend />)
  expect(html).toContain('aria-label="Keyboard shortcuts"')
  expect(html).toContain('<kbd>C</kbd>')
  expect(html).toContain('Cycle cutaway plane')
  expect(html).toContain('Focus selection')
  expect(html).toContain('<kbd>V</kbd>')
  expect(html).toContain('Voice input on / off')
})
