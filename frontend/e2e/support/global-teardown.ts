import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Drops this run's temporary database directory (created by the api web server). */
export default function globalTeardown(): void {
  const dir = process.env.E2E_DATA_DIR
  // Only ever delete what the config created: a `cc-e2e-*` directory under the OS tmp dir.
  if (!dir || path.dirname(dir) !== tmpdir() || !path.basename(dir).startsWith('cc-e2e-')) return
  rmSync(dir, { recursive: true, force: true })
}
