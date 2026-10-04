import type { AdminTeam, AdminTeamDetail, AdminUser } from '@/features/admin'
import type { Schemas } from '@/lib/api'
import { NOW, minutesFrom } from './case-fixtures'
import {
  TEAM_ANDES,
  TEAM_PACIFICO,
  TEAM_PLATFORM,
  adminStaff,
  analystStaff,
  supervisorAdminStaff,
} from './fixtures'

/**
 * Invented directory for tests ("Datos de ejemplo"): people, ids and teams follow
 * the slice 4 seed story (contract §11), never dataset records.
 */

export const TEAM_CARIBE = {
  id: 'TEAM-00000000000000000000000004',
  name: 'Equipo Caribe',
}

export const MARIANA_ID = 'STF-SUP0000007'
export const ANDRES_V_ID = 'STF-ANA0000013'

const T30 = new Date(NOW.getTime() - 30 * 24 * 3_600_000).toISOString()

export function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'STF-ANA0000099',
    name: 'Persona de Ejemplo',
    email: 'persona@latambank.example',
    roles: ['analyst'],
    languages: ['es'],
    team: TEAM_ANDES,
    status: 'active',
    lockedUntil: null,
    failedAttempts: 0,
    lastLoginAt: minutesFrom(-120),
    availability: 'paused',
    openCases: { total: 0, es: 0, pt: 0 },
    createdAt: T30,
    guards: { isSelf: false, lastActiveAdmin: false },
    version: 3,
    ...overrides,
  }
}

/** The signed-in admin herself (`adminStaff`). */
export const selfAdmin = makeAdminUser({
  id: adminStaff.id,
  name: adminStaff.name,
  email: adminStaff.email,
  roles: ['admin'],
  team: TEAM_PLATFORM,
  availability: null,
  guards: { isSelf: true, lastActiveAdmin: false },
})

/** The other admin (Supervisora + Administración). */
export const carolina = makeAdminUser({
  id: supervisorAdminStaff.id,
  name: supervisorAdminStaff.name,
  email: supervisorAdminStaff.email,
  roles: ['supervisor', 'admin'],
  languages: [],
  team: TEAM_PLATFORM,
  availability: null,
})

/** Daniela: Analista · es, pt · Andes, five open cases (4 es, 1 pt). */
export const daniela = makeAdminUser({
  id: analystStaff.id,
  name: analystStaff.name,
  email: analystStaff.email,
  roles: ['analyst'],
  languages: ['es', 'pt'],
  team: TEAM_ANDES,
  availability: 'available',
  openCases: { total: 5, es: 4, pt: 1 },
  version: 7,
})

/** Mariana: Supervisora, locked until T+13m after five wrong passwords. */
export const mariana = makeAdminUser({
  id: MARIANA_ID,
  name: 'Mariana Duque',
  email: 'mariana.duque@latambank.example',
  roles: ['supervisor'],
  languages: ['es'],
  team: TEAM_PACIFICO,
  status: 'locked',
  lockedUntil: minutesFrom(13),
  failedAttempts: 5,
  availability: null,
})

/** Andrés Villamil: an inactive analyst. */
export const andres = makeAdminUser({
  id: ANDRES_V_ID,
  name: 'Andrés Villamil',
  email: 'andres.villamil@latambank.example',
  status: 'inactive',
  availability: 'paused',
  lastLoginAt: null,
})

export function makeUserList(
  items: AdminUser[] = [carolina, daniela, mariana, selfAdmin],
  overrides: Partial<Schemas['AdminUserList']> = {},
): Schemas['AdminUserList'] {
  return {
    items,
    roleCounts: { all: 12, analyst: 6, supervisor: 5, admin: 2 },
    statusCounts: { active: 12, locked: 1, inactive: 1, all: 13 },
    serverTime: NOW.toISOString(),
    ...overrides,
  }
}

export function makeAdminTeam(overrides: Partial<AdminTeam> = {}): AdminTeam {
  return {
    ...TEAM_ANDES,
    active: true,
    memberCount: 4,
    analystCount: 3,
    inactiveMemberCount: 1,
    createdAt: T30,
    version: 1,
    ...overrides,
  }
}

export const teamAndes = makeAdminTeam()
export const teamPacifico = makeAdminTeam({
  ...TEAM_PACIFICO,
  memberCount: 6,
  analystCount: 3,
  inactiveMemberCount: 0,
})
export const teamPlatform = makeAdminTeam({
  ...TEAM_PLATFORM,
  memberCount: 2,
  analystCount: 0,
  inactiveMemberCount: 0,
})
export const teamCaribe = makeAdminTeam({
  ...TEAM_CARIBE,
  active: false,
  memberCount: 0,
  analystCount: 0,
  inactiveMemberCount: 0,
  createdAt: new Date(NOW.getTime() - 3 * 24 * 3_600_000).toISOString(),
  version: 2,
})

export function makeTeamList(
  items: AdminTeam[] = [teamPlatform, teamAndes, teamPacifico, teamCaribe],
): Schemas['AdminTeamList'] {
  return { items, statusCounts: { active: 3, inactive: 1, all: 4 } }
}

export function makeTeamDetail(
  team: AdminTeam = teamAndes,
  members: AdminTeamDetail['members'] = [
    {
      id: daniela.id,
      name: daniela.name,
      roles: ['analyst'],
      languages: ['es', 'pt'],
      status: 'active',
    },
    { id: andres.id, name: andres.name, roles: ['analyst'], languages: ['es'], status: 'inactive' },
  ],
): AdminTeamDetail {
  return { team, members }
}
