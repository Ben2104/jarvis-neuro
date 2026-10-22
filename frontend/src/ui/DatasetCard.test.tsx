import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ProvenanceBadge } from './DatasetCard'
import { PROVENANCE_LABEL } from './format'

it('badges each provenance with its label and a provenance class', () => {
  for (const p of ['ground-truth', 'monai-segresnet', 'synthetic'] as const) {
    const html = renderToStaticMarkup(<ProvenanceBadge provenance={p} />)
    expect(html).toContain(PROVENANCE_LABEL[p])
    expect(html).toContain(`prov-${p}`)
  }
})
