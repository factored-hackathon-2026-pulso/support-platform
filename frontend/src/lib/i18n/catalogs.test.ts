/**
 * Slice 23: every locale has the same catalogs, the same keys and the same placeholders as
 * the Spanish source (the compiler checks the keys too: `satisfies Translation<typeof es>`).
 */
import { describe, expect, it } from 'vitest'
import { NAMESPACES } from '@/locales/namespaces'
import { APP_LOCALES, DEFAULT_LOCALE } from './locale'

type Catalog = { [key: string]: string | Catalog }

const CATALOGS = import.meta.glob<{ default: Catalog }>('/src/locales/*/*.ts', { eager: true })

function catalog(locale: string, namespace: string): Catalog | undefined {
  return CATALOGS[`/src/locales/${locale}/${namespace}.ts`]?.default
}

/** "a.b.c" → value, for every leaf. */
function leaves(value: Catalog, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') out.set(path, child)
    else for (const [k, v] of leaves(child, path)) out.set(k, v)
  }
  return out
}

/** The interpolation names of a string: "{{count, number}} de {{name}}" → count, name. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((match) => match[1] ?? '').sort()
}

describe('translation catalogs', () => {
  it('registers exactly the namespaces that have files', () => {
    const files = Object.keys(CATALOGS)
      .filter((path) => path.startsWith(`/src/locales/${DEFAULT_LOCALE}/`))
      .map((path) => path.split('/').pop()?.replace(/\.ts$/, ''))
      .sort()
    expect(files).toEqual([...NAMESPACES].sort())
  })

  for (const locale of APP_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
    describe(`${locale}`, () => {
      for (const namespace of NAMESPACES) {
        it(`${namespace}: same keys and placeholders as Spanish`, () => {
          const source = catalog(DEFAULT_LOCALE, namespace)
          const translation = catalog(locale, namespace)
          expect(source, `src/locales/${DEFAULT_LOCALE}/${namespace}.ts`).toBeDefined()
          expect(translation, `src/locales/${locale}/${namespace}.ts`).toBeDefined()
          const es = leaves(source ?? {})
          const other = leaves(translation ?? {})
          expect([...other.keys()].sort()).toEqual([...es.keys()].sort())
          for (const [key, text] of es) {
            expect(placeholders(other.get(key) ?? ''), `${namespace}:${key}`).toEqual(
              placeholders(text),
            )
          }
        })
      }
    })
  }

  it('never leaves a value empty', () => {
    const empty = Object.entries(CATALOGS).flatMap(([path, module]) =>
      [...leaves(module.default)]
        .filter(([, text]) => text.trim() === '')
        .map(([key]) => `${path} ${key}`),
    )
    expect(empty).toEqual([])
  })
})
