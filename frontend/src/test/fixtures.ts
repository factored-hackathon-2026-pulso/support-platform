import type { Staff } from '@/app/session'

/**
 * Invented staff for tests ("Datos de ejemplo"): never copy dataset records here.
 */
export const analystStaff: Staff = {
  id: 'STF-ANA0000001',
  name: 'Daniela Ríos Medina',
  email: 'daniela.rios@latambank.example',
  roles: ['analyst'],
  languages: ['es', 'pt'],
  team: 'Disputas · Equipo Andes',
}

/** Analista + Supervisora (team lead): exercises the role switcher. */
export const supervisorStaff: Staff = {
  id: 'STF-SUP0000001',
  name: 'Laura Méndez Castro',
  email: 'laura.mendez@latambank.example',
  roles: ['supervisor', 'analyst'],
  languages: ['es'],
  team: 'Disputas · Equipo Andes',
}

/** Administración only. */
export const adminStaff: Staff = {
  id: 'STF-ADM0000001',
  name: 'Andrés Salazar Pinto',
  email: 'andres.salazar@latambank.example',
  roles: ['admin'],
  languages: ['es'],
  team: 'Administración de la plataforma',
}

/** Supervisora + Administración: two roles without the analyst one. */
export const supervisorAdminStaff: Staff = {
  id: 'STF-SAD0000001',
  name: 'Carolina Peña Ruiz',
  email: 'carolina.pena@latambank.example',
  roles: ['admin', 'supervisor'],
  languages: ['es'],
  team: 'Administración de la plataforma',
}

export const allRolesStaff: Staff = {
  id: 'STF-ALL0000001',
  name: 'Sofía Herrera Luna',
  email: 'sofia.herrera@latambank.example',
  roles: ['admin', 'supervisor', 'analyst'],
  languages: ['es'],
  team: 'Disputas · Equipo Pacífico',
}
