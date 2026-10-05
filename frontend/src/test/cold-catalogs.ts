/**
 * A first visit, as far as the catalogs go (slice 23): only the entry chunk's namespaces
 * (`common`, `shell`) are loaded, so every other one is fetched by the screen that needs it.
 * The test setup preloads every catalog; `unloadLazyCatalogs` undoes that for one test and
 * `loadAllCatalogs` (from `@/lib/i18n`) restores it.
 *
 * `rawCatalogKeys` finds catalog keys printed instead of their text (i18next has no fallback
 * language: a namespace that was not loaded when a model read it shows its keys).
 */
import { APP_LOCALES, i18n } from '@/lib/i18n'
import { EAGER_NAMESPACES, NAMESPACES, type Namespace } from '@/locales/namespaces'

const EAGER: readonly Namespace[] = EAGER_NAMESPACES

/** The namespaces outside the entry chunk. */
export const LAZY_NAMESPACES: readonly Namespace[] = NAMESPACES.filter((ns) => !EAGER.includes(ns))

interface BackendState {
  state: Record<string, number>
}

/** Drop every lazy catalog of every locale, as on a cold page load. */
export function unloadLazyCatalogs(): void {
  const connector = i18n.services.backendConnector as unknown as BackendState
  for (const locale of APP_LOCALES) {
    for (const namespace of LAZY_NAMESPACES) {
      i18n.removeResourceBundle(locale, namespace)
      delete connector.state[`${locale}|${namespace}`]
    }
  }
}

function leafKeys(value: unknown, prefix: string, into: Set<string>): void {
  if (typeof value === 'string') {
    into.add(prefix.replace(/_(one|other)$/, ''))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      leafKeys(child, prefix ? `${prefix}.${key}` : key, into)
    }
  }
}

const SPANISH_CATALOGS = import.meta.glob<{ default: unknown }>('../locales/es/*.ts', {
  eager: true,
})

/** Every dotted key path of the Spanish catalogs (a raw key is printed without its namespace). */
function catalogKeys(): Set<string> {
  const keys = new Set<string>()
  for (const module of Object.values(SPANISH_CATALOGS)) leafKeys(module.default, '', keys)
  return new Set([...keys].filter((key) => key.includes('.')))
}

const KEYS = catalogKeys()

/** The text a person reads or hears in `root`: its text plus the labels of its elements. */
function readableText(root: HTMLElement): string {
  const labels = [...root.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((name) => el.getAttribute(name) ?? ''),
  )
  return [root.textContent ?? '', ...labels, document.title].join('\n')
}

/** The catalog keys printed in `root` instead of their text (none on a healthy screen). */
export function rawCatalogKeys(root: HTMLElement = document.body): string[] {
  const text = readableText(root)
  return [...KEYS].filter((key) => text.includes(key))
}
