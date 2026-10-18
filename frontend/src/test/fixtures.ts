import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONTEND_DIR = fileURLToPath(new URL('../../', import.meta.url))
export const PUBLIC_DIR = join(FRONTEND_DIR, 'public')
export const SYNTH_DIR = join(PUBLIC_DIR, 'cases/synth_001/synthetic')
export const SHARED_SCHEMA_PATH = join(FRONTEND_DIR, '..', 'shared', 'manifest.schema.json')

// eslint-style escape hatch: fixtures are untyped JSON that tests mutate on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readSynthManifestJson(): any {
  return readJson(join(SYNTH_DIR, 'manifest.json'))
}

export function readSynthBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(SYNTH_DIR, file)))
}

/**
 * A fetch that serves URL paths from frontend/public. `overrides` is read at call
 * time, so a test can break one URL after a successful first load.
 */
export function fsFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    const override = overrides[url]
    if (override) return override()
    const file = join(PUBLIC_DIR, url)
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(readFileSync(file)))
  }) as typeof fetch
}
