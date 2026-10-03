/**
 * Import boundaries of the SPA (brief §5.2, ARCHITECTURE.md §3), checked on every
 * `pnpm test` like backend/tests/test_architecture.py does for the API layers.
 *
 * Every static import, re-export, dynamic `import()` and `vi.mock()` under src/ is
 * resolved (alias `@/` and relative paths) and checked against the rules below.
 * A feature has two public files: `index.ts` (everything, screens included) and
 * `core.ts` (no components, transitively). The always-loaded app shell imports
 * `core.ts` only, so no screen ends up in the entry chunk (ARCHITECTURE.md §3).
 * oxlint's `no-restricted-imports` (.oxlintrc.json) flags the most common case,
 * deep feature imports, in the editor; this test is the authoritative check.
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const THIS_FILE = 'src/test/architecture.test.ts'

interface ImportEdge {
  /** Importing file, e.g. "src/routes/auth/login.tsx". */
  from: string
  /** Specifier as written. */
  specifier: string
  /** Resolved module path without extension or "/index", e.g. "src/features/auth". */
  target: string
  /** `import type` / `export type`: erased at build time, so it never loads the target. */
  typeOnly: boolean
}

const TYPE_ONLY = /^(?:import|export)\s+type\s/

const IMPORT_PATTERNS = [
  // import x from '…' / import type { x } from '…' / export { x } from '…' / export * from '…'
  /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  // import '…' (side effects)
  /\bimport\s*['"]([^'"]+)['"]/g,
  // import('…') and vi.mock('…')
  /\b(?:import|vi\.mock)\s*\(\s*['"]([^'"]+)['"]/g,
]

/** Drops comments so documentation examples are not taken for imports. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Project path of a specifier, or null for packages (react, vitest…). */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let path: string
  if (specifier.startsWith('@/')) path = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('.')) {
    const dir = fromFile.split('/').slice(0, -1).join('/')
    path = `${dir}/${specifier}`
  } else return null
  return normalize(path)
    .replace(/\?.*$/, '')
    .replace(/\.(tsx?|jsx?|css)$/, '')
    .replace(/\/index$/, '')
}

function collectEdges(): ImportEdge[] {
  const edges: ImportEdge[] = []
  for (const [key, source] of Object.entries(SOURCES)) {
    const from = key.replace(/^\//, '')
    if (from === THIS_FILE) continue
    const code = stripComments(source)
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const specifier = match[1]
        if (!specifier) continue
        const target = resolveSpecifier(from, specifier)
        if (target) edges.push({ from, specifier, target, typeOnly: TYPE_ONLY.test(match[0]) })
      }
    }
  }
  return edges
}

const isTestFile = (file: string) => /\.test\.tsx?$/.test(file) || file.startsWith('src/test/')
const inDir = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
/** "auth" for "src/features/auth/…", else null. */
const featureOf = (path: string) => /^src\/features\/([^/]+)/.exec(path)?.[1] ?? null
/** The two public files of a feature: its `index.ts` ("src/features/x") and its `core.ts`. */
const isFeatureIndex = (path: string) => /^src\/features\/[^/]+$/.test(path)
const isFeatureCore = (path: string) => /^src\/features\/[^/]+\/core$/.test(path)
/** Modules that render: a feature's components, the design system and the layout. */
const isUiModule = (path: string) =>
  /^src\/features\/[^/]+\/components\//.test(path) || inDir(path, 'src/components/layout')
/** The always-loaded shell: everything in src/app but the route table, plus the entry. */
const isAppShell = (file: string) =>
  !isTestFile(file) &&
  (file === 'src/main.tsx' || (inDir(file, 'src/app') && file !== 'src/app/router.tsx'))

interface Rule {
  name: string
  /** Returns true when the edge breaks the rule. */
  violates: (edge: ImportEdge) => boolean
}

const RULES: Rule[] = [
  {
    name: 'features are imported only through their index.ts or core.ts (tests may mock api.ts)',
    violates: ({ from, target }) => {
      const feature = featureOf(target)
      if (!feature || featureOf(from) === feature) return false
      const root = `src/features/${feature}`
      if (target === root || target === `${root}/core`) return false
      return !(isTestFile(from) && target === `${root}/api`)
    },
  },
  {
    name: 'the app shell imports features only through their core.ts (no screens in the entry)',
    violates: ({ from, target, typeOnly }) =>
      isAppShell(from) && !typeOnly && featureOf(target) !== null && !isFeatureCore(target),
  },
  {
    name: 'only src/routes and the route table (app/router.tsx) import route modules',
    violates: ({ from, target }) =>
      inDir(target, 'src/routes') && !inDir(from, 'src/routes') && from !== 'src/app/router.tsx',
  },
  {
    name: 'components/ui is independent of the app, features, routes and layout',
    violates: ({ from, target }) =>
      inDir(from, 'src/components/ui') &&
      ['src/app', 'src/features', 'src/routes', 'src/components/layout'].some((dir) =>
        inDir(target, dir),
      ),
  },
  {
    name: 'components never import features (the app composes them)',
    violates: ({ from, target }) =>
      inDir(from, 'src/components') && !isTestFile(from) && inDir(target, 'src/features'),
  },
  {
    name: 'lib is framework infrastructure: no app, features, routes or components',
    violates: ({ from, target }) =>
      inDir(from, 'src/lib') &&
      !isTestFile(from) &&
      ['src/app', 'src/features', 'src/routes', 'src/components'].some((dir) => inDir(target, dir)),
  },
  {
    name: 'features use only the session and role helpers of src/app',
    violates: ({ from, target }) =>
      inDir(from, 'src/features') &&
      !isTestFile(from) &&
      inDir(target, 'src/app') &&
      !['src/app/session', 'src/app/roles'].includes(target),
  },
  {
    name: 'test helpers (src/test) are used by tests only',
    violates: ({ from, target }) => inDir(target, 'src/test') && !isTestFile(from),
  },
]

describe('import boundaries', () => {
  const edges = collectEdges()

  it('reads the source tree', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    expect(edges.length).toBeGreaterThan(100)
  })

  it.each(RULES.map((rule) => [rule.name, rule] as const))('%s', (_name, rule) => {
    const offending = edges
      .filter((edge) => rule.violates(edge))
      .map(({ from, specifier }) => `${from} → ${specifier}`)
    expect(offending).toEqual([])
  })
})

/** Source file of a resolved module path ("src/features/x/core" → "src/features/x/core.ts"). */
function fileOf(target: string): string | null {
  for (const candidate of [
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ]) {
    if (`/${candidate}` in SOURCES) return candidate
  }
  return null
}

/**
 * Every module a file loads at runtime (type-only imports skipped), with the
 * chain that reaches it, e.g. "core → realtime → api".
 */
function runtimeClosure(start: string, edges: readonly ImportEdge[]): Map<string, string[]> {
  const byFile = new Map<string, ImportEdge[]>()
  for (const edge of edges) {
    if (edge.typeOnly) continue
    byFile.set(edge.from, [...(byFile.get(edge.from) ?? []), edge])
  }
  const reached = new Map<string, string[]>([[start, [start]]])
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.shift()!
    for (const { target } of byFile.get(file) ?? []) {
      const next = fileOf(target)
      if (!next || reached.has(next)) continue
      reached.set(next, [...reached.get(file)!, next])
      queue.push(next)
    }
  }
  return reached
}

const moduleOf = (file: string) => file.replace(/\.tsx?$/, '').replace(/\/index$/, '')

describe('feature core files', () => {
  const edges = collectEdges()
  const cores = Object.keys(SOURCES)
    .map((key) => key.replace(/^\//, ''))
    .filter((file) => isFeatureCore(moduleOf(file)))

  it('exist for the features the app shell composes', () => {
    expect(cores.sort()).toEqual(
      expect.arrayContaining([
        'src/features/admin/core.ts',
        'src/features/cases/core.ts',
        'src/features/conversation/core.ts',
        'src/features/supervision/core.ts',
      ]),
    )
  })

  it.each(cores)('%s never loads a component or a feature index.ts', (core) => {
    const offending = [...runtimeClosure(core, edges).entries()]
      .filter(([file]) => isUiModule(moduleOf(file)) || isFeatureIndex(moduleOf(file)))
      .map(([, chain]) => chain.join(' → '))
    expect(offending).toEqual([])
  })
})

describe('import boundary rules', () => {
  const check = (from: string, specifier: string, typeOnly = false) => {
    const target = resolveSpecifier(from, specifier)
    if (!target) return []
    return RULES.filter((rule) => rule.violates({ from, specifier, target, typeOnly })).map(
      (r) => r.name,
    )
  }

  it('resolves aliases and relative paths', () => {
    expect(resolveSpecifier('src/routes/auth/login.tsx', '../../features/auth/model')).toBe(
      'src/features/auth/model',
    )
    expect(resolveSpecifier('src/app/router.tsx', '@/features/auth/index.ts')).toBe(
      'src/features/auth',
    )
    expect(resolveSpecifier('src/app/router.tsx', 'react-router')).toBeNull()
  })

  it('catches the typical mistakes', () => {
    expect(check('src/routes/auth/login.tsx', '@/features/auth/model')).toHaveLength(1)
    expect(check('src/routes/auth/login.tsx', '../../features/auth/components/X')).toHaveLength(1)
    expect(check('src/features/cases/api.ts', '@/features/auth/api')).toHaveLength(1)
    expect(check('src/features/auth/x.ts', '@/routes/auth/login')).toHaveLength(1)
    expect(check('src/components/ui/Button.tsx', '@/app/session')).toHaveLength(1)
    expect(check('src/lib/format.ts', '@/components/ui')).toHaveLength(1)
    expect(check('src/features/auth/x.ts', '@/app/router')).toHaveLength(1)
    expect(check('src/app/rail-indicators.ts', '@/features/admin')).toHaveLength(1)
    expect(check('src/app/session-live.tsx', '../features/admin/index.ts')).toHaveLength(1)
    expect(check('src/main.tsx', '@/features/cases')).toHaveLength(1)
    expect(check('src/routes/admin/users.tsx', '@/features/admin/realtime')).toHaveLength(1)
  })

  it('allows the documented imports', () => {
    expect(check('src/routes/auth/login.tsx', '@/features/auth')).toEqual([])
    expect(check('src/features/auth/components/X.tsx', '../model')).toEqual([])
    expect(check('src/routes/auth/auth.test.tsx', '@/features/auth/api')).toEqual([])
    expect(check('src/features/auth/x.ts', '@/app/session')).toEqual([])
    expect(check('src/components/layout/AppShell.tsx', '@/app/rail-indicators')).toEqual([])
    expect(check('src/app/router.tsx', '@/routes/auth/login')).toEqual([])
    expect(check('src/app/rail-indicators.ts', '@/features/admin/core')).toEqual([])
    expect(check('src/app/x.ts', '@/features/admin', true)).toEqual([])
    expect(check('src/features/conversation/model.ts', '@/features/cases/core')).toEqual([])
    expect(check('src/app/rail-indicators.test.tsx', '@/features/admin')).toEqual([])
  })
})
