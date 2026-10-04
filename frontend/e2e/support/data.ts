/**
 * Seeded accounts and customers the scenarios rely on ("Datos de ejemplo",
 * invented people; see backend/README.md). Every person a scenario signs in as
 * to work cases is created by the scenario itself, so nothing here is mutated.
 */

export const DEMO_PASSWORD = 'demo1234'
export const DEV_MFA_CODE = '000000'

export const SEEDED = {
  /** Supervisión (es, pt). */
  supervisor: { name: 'Lucía Herrera', email: 'lucia.herrera@latambank.example' },
  /** Administración. */
  admin: { name: 'Valeria Quintero', email: 'valeria.quintero@latambank.example' },
} as const

export const TEAM_ANDES = 'Equipo Andes'

export type Language = 'es' | 'pt'

export interface DemoCustomerRef {
  id: string
  name: string
  language: Language
}

/**
 * Simulator customers, one set per scenario so that a scenario never writes as
 * a customer another one is using. Ids and names are the backend seed.
 */
export const CUSTOMERS = {
  natalia: { id: 'CUS-00000000000000000000002001', name: 'Natalia Guzmán Rincón', language: 'es' },
  ximena: { id: 'CUS-00000000000000000000002002', name: 'Ximena Robles Treviño', language: 'es' },
  lucas: { id: 'CUS-00000000000000000000002003', name: 'Lucas Benítez Sosa', language: 'es' },
  rafael: { id: 'CUS-00000000000000000000002004', name: 'Rafael Nogueira Costa', language: 'pt' },
  andres: { id: 'CUS-00000000000000000000002005', name: 'Andrés Felipe Cardona', language: 'es' },
  gabriela: { id: 'CUS-00000000000000000000001008', name: 'Gabriela Duarte Melo', language: 'pt' },
} as const satisfies Record<string, DemoCustomerRef>

const FIRST_NAMES = ['Inés', 'Mateo', 'Lorena', 'Bruno', 'Alicia', 'Gonzalo', 'Mireya', 'Ramiro']
const LAST_NAMES = ['Calderón', 'Ospina', 'Barrios', 'Zamudio', 'Toledo', 'Iriarte', 'Saldaña']
let counter = 0

/** A short tag unique within the run (letters only, so it reads like a surname). */
function uniqueTag(): string {
  counter += 1
  const value = Date.now().toString(36).slice(-4) + counter.toString(36)
  return value.replace(/\d/g, (digit) => 'abcdefghij'.charAt(Number(digit)))
}

/**
 * An invented person with a unique name and a unique `@latambank.example` email.
 * First names rotate, so the people one scenario creates never share one (the
 * assign dialog says "Asignar a {nombre}").
 */
export function inventPerson(): { name: string; email: string } {
  const tag = uniqueTag()
  const first = FIRST_NAMES[counter % FIRST_NAMES.length] ?? 'Inés'
  const last = LAST_NAMES[counter % LAST_NAMES.length] ?? 'Calderón'
  const surname = tag.charAt(0).toUpperCase() + tag.slice(1)
  return {
    name: `${first} ${last} ${surname}`,
    email: `e2e.${first
      .normalize('NFD')
      .replace(/[^a-z]/gi, '')
      .toLowerCase()}.${tag}@latambank.example`,
  }
}

/** A message text unique within the run, so assertions never match an older turn. */
export function uniqueText(prefix: string): string {
  return `${prefix} (ref ${uniqueTag()})`
}

/** "Inés Calderón Abcd" → "Inés" (what the customer and the assign buttons show). */
export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches a text that contains this one (for `toHaveText([...])` over transcript items). */
export function containing(text: string): RegExp {
  return new RegExp(escapeRegExp(text))
}

/** Matches any of these texts (to pick a scenario's own messages out of a transcript). */
export function anyOf(...texts: string[]): RegExp {
  return new RegExp(texts.map(escapeRegExp).join('|'))
}

/** An accessible name that starts with this person's full name ("Natalia Guzmán Rincón , Nuevo …"). */
export function startsWithName(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name)}(?!\\p{L})`, 'u')
}
