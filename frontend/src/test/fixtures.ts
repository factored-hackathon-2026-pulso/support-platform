import type { Staff } from '@/app/session'

/**
 * Invented staff for tests ("Datos de ejemplo"): never copy dataset records here.
 */
export const analystStaff: Staff = {
  id: 'STF-ANA0000001',
  name: 'Daniela Ríos Medina',
  email: 'daniela.rios@latambank.example',
  roles: ['analyst'],
  level: 'Specialist',
  languages: ['es', 'pt'],
  team: 'Disputas · Equipo Andes',
  requiresFourEyes: false,
}

export const supervisorStaff: Staff = {
  id: 'STF-SUP0000001',
  name: 'Laura Méndez Castro',
  email: 'laura.mendez@latambank.example',
  roles: ['supervisor', 'analyst'],
  level: 'Senior',
  languages: ['es'],
  team: 'Disputas · Equipo Andes',
  requiresFourEyes: false,
}

/** Automatización + Administración: exercises four-eyes on admin changes. */
export const automationAdminStaff: Staff = {
  id: 'STF-AUT0000001',
  name: 'Andrés Salazar Pinto',
  email: 'andres.salazar@latambank.example',
  roles: ['automation', 'admin'],
  level: 'Senior',
  languages: ['es'],
  team: 'Automatización',
  requiresFourEyes: true,
}

export const allRolesStaff: Staff = {
  id: 'STF-ALL0000001',
  name: 'Sofía Herrera Luna',
  email: 'sofia.herrera@latambank.example',
  roles: ['admin', 'automation', 'supervisor', 'analyst'],
  level: 'Specialist',
  languages: ['es'],
  team: 'Disputas · Equipo Pacífico',
  requiresFourEyes: true,
}
