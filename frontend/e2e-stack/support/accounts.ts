import type { DemoCustomerRef } from '../../e2e/support/data'

/**
 * Seeded accounts the stack suite works with (RUNBOOK §5: password `demo1234`, dev code
 * `000000`; Tatiana Rojas signs in with her authenticator key). The suite creates nobody: the
 * stack's database outlives a run, and only seeded people can always be signed in again.
 */
export interface SeededAccount {
  name: string
  email: string
  /** Only for someone who joined by invitation (her authenticator's key). */
  totpSecret?: string
}

const account = (name: string, local: string, totpSecret?: string): SeededAccount => ({
  name,
  email: `${local}@latambank.example`,
  ...(totpSecret ? { totpSecret } : {}),
})

export const ACCOUNTS = {
  /** Analista, Spanish + Portuguese, no seeded cases: the person hand-overs reach. */
  analyst: account('Tomás Arango', 'tomas.arango'),
  /**
   * Analista, Spanish + Portuguese, always paused: cleanup moves what a scenario left open to
   * him and closes it.
   */
  janitor: account('Sebastián Cárdenas', 'sebastian.cardenas'),
  supervisor: account('Lucía Herrera', 'lucia.herrera'),
  admin: account('Valeria Quintero', 'valeria.quintero'),
} as const

/** Every seeded person who can be available (Analista), to pause them before a run. */
export const SEEDED_ANALYSTS: readonly SeededAccount[] = [
  account('Daniela Ríos', 'daniela.rios'),
  account('Julián Ortega', 'julian.ortega'),
  account('Paula Medina', 'paula.medina'),
  ACCOUNTS.janitor,
  ACCOUNTS.analyst,
  account('Felipe Echeverri', 'felipe.echeverri'),
  account('Tatiana Rojas', 'tatiana.rojas', 'JBSWY3DPEHPK3PXP'),
]

/**
 * The only simulator customers linked to agent-core's demo ids (stack/README.md): Natalia →
 * `cust-001` (Spanish), Rafael → `cust-002` (Portuguese). Only synthetic data reaches the model.
 */
export const LINKED = {
  natalia: { id: 'CUS-00000000000000000000002001', name: 'Natalia Guzmán Rincón', language: 'es' },
  rafael: { id: 'CUS-00000000000000000000002004', name: 'Rafael Nogueira Costa', language: 'pt' },
} as const satisfies Record<string, DemoCustomerRef>
