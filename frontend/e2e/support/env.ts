/**
 * Where the servers of this run live. `playwright.config.ts` picks the ports and
 * the temporary database once and passes them down through `process.env`.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set: run the suite with \`pnpm e2e\``)
  return value
}

/** API origin of this run (no `/api/v1`), e.g. `http://127.0.0.1:61234`. */
export const API_URL = required('E2E_API_URL')

/** SPA origin of this run (the Vite dev server). */
export const WEB_URL = required('E2E_WEB_URL')
