import type { Staff } from '@/app/session'

/** Seeded teams (slice 4 §11.1): invented names, `TEAM-…` ids. */
export const TEAM_ANDES = { id: 'TEAM-00000000000000000000000001', name: 'Equipo Andes' }
export const TEAM_PACIFICO = {
  id: 'TEAM-00000000000000000000000002',
  name: 'Equipo Pacífico',
}
export const TEAM_PLATFORM = {
  id: 'TEAM-00000000000000000000000003',
  name: 'Administración de la plataforma',
}

/**
 * Invented staff for tests ("Datos de ejemplo"): never copy dataset records here.
 */
export const analystStaff: Staff = {
  id: 'STF-ANA0000001',
  name: 'Daniela Ríos Medina',
  email: 'daniela.rios@latambank.example',
  roles: ['analyst'],
  languages: ['es', 'pt'],
  team: TEAM_ANDES,
  active: true,
}

/** Analista + Supervisora (team lead): exercises the role switcher. */
export const supervisorStaff: Staff = {
  id: 'STF-SUP0000001',
  name: 'Laura Méndez Castro',
  email: 'laura.mendez@latambank.example',
  roles: ['supervisor', 'analyst'],
  languages: ['es'],
  team: TEAM_ANDES,
  active: true,
}

/** Administración only. */
export const adminStaff: Staff = {
  id: 'STF-ADM0000001',
  name: 'Andrés Salazar Pinto',
  email: 'andres.salazar@latambank.example',
  roles: ['admin'],
  languages: ['es'],
  team: TEAM_PLATFORM,
  active: true,
}

/** Supervisora + Administración: two roles without the analyst one. */
export const supervisorAdminStaff: Staff = {
  id: 'STF-SAD0000001',
  name: 'Carolina Peña Ruiz',
  email: 'carolina.pena@latambank.example',
  roles: ['admin', 'supervisor'],
  languages: ['es'],
  team: TEAM_PLATFORM,
  active: true,
}

export const allRolesStaff: Staff = {
  id: 'STF-ALL0000001',
  name: 'Sofía Herrera Luna',
  email: 'sofia.herrera@latambank.example',
  roles: ['admin', 'supervisor', 'analyst'],
  languages: ['es'],
  team: TEAM_PACIFICO,
  active: true,
}
