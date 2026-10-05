/**
 * Slice 23 guard rail: no UI copy outside the catalogs (`src/locales`). Areas not migrated
 * yet are listed in `i18n-allowlist.ts`. `I18N_REPORT=1 pnpm test i18n-literals` prints the
 * remaining literals per area.
 */
import { describe, expect, it } from 'vitest'
import { LOCALE_DATA_FILES, PENDING_AREAS } from './i18n-allowlist'
import { findLiterals, isScannedFile, type LiteralFinding } from './i18n-literals'

const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function scanAll(proseInTs = false): LiteralFinding[] {
  return Object.entries(SOURCES)
    .map(([key, source]) => [key.replace(/^\//, ''), source] as const)
    .filter(([file]) => isScannedFile(file) && !LOCALE_DATA_FILES.includes(file))
    .flatMap(([file, source]) => findLiterals(file, source, { proseInTs }))
}

function areaOf(file: string): string | null {
  return (
    PENDING_AREAS.find((area) => area.paths.some((path) => file.startsWith(path)))?.area ?? null
  )
}

const findings = scanAll()

/**
 * `I18N_REPORT=1` prints counts per area (`.ts` scanned like `.tsx`: an estimate of the work
 * left); `I18N_REPORT=all` also every literal.
 */
const REPORT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
  ?.env.I18N_REPORT

describe('UI copy lives in the catalogs', () => {
  if (REPORT) {
    const estimate = scanAll(true)
    const counts = new Map<string, number>()
    for (const finding of estimate) {
      const area = areaOf(finding.file) ?? '(not pending)'
      counts.set(area, (counts.get(area) ?? 0) + 1)
    }
    console.warn(
      [...counts]
        .sort()
        .map(([area, count]) => `${area}: ${count}`)
        .join('\n'),
    )
    if (REPORT === 'all') {
      console.warn(estimate.map((f) => `${f.file}:${f.line} ${f.text}`).join('\n'))
    }
  }

  it('has no literal outside the pending areas', () => {
    const outside = findings
      .filter((finding) => areaOf(finding.file) === null)
      .map((finding) => `${finding.file}:${finding.line} "${finding.text}"`)
    expect(outside, 'Move these to src/locales (ARCHITECTURE.md §12)').toEqual([])
  })

  it('lists only areas that still have literals', () => {
    const done = PENDING_AREAS.filter(
      (area) => !findings.some((finding) => areaOf(finding.file) === area.area),
    ).map((area) => area.area)
    expect(done, 'Migrated: delete their blocks from i18n-allowlist.ts').toEqual([])
  })

  it('never lists a path twice', () => {
    const paths = PENDING_AREAS.flatMap((area) => area.paths)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
