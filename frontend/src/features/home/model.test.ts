import { describe, expect, it } from 'vitest'
import { NOW, makeCaseSummary, makeCounts, minutesFrom, seededInbox } from '@/test/case-fixtures'
import { canvasFeed, makeActivityItem, makeHome } from '@/test/home-fixtures'
import {
  EMPTY_FEED_COPY,
  activityLinkLabel,
  activityRow,
  activityTemplate,
  availabilityBlockCopy,
  availableValue,
  feedToggleLabel,
  feedTruncatedNote,
  firstCases,
  greeting,
  greetingFor,
  headerLine,
  languageFact,
  queueWait,
  sinceFacts,
  statusTiles,
  teamRows,
} from './model'
import type { HomeActivityKind } from './types'

// Tests run in America/Bogota: NOW (16:00 UTC) is 11:00 there.

/** No visible metadata is ever joined with "·" (slice 6 UI rule). */
const texts = (facts: { text: string }[]) => facts.map((fact) => fact.text)

describe('header', () => {
  it('greets by the local time of day', () => {
    expect(greetingFor(5)).toBe('Buenos días')
    expect(greetingFor(11)).toBe('Buenos días')
    expect(greetingFor(12)).toBe('Buenas tardes')
    expect(greetingFor(18)).toBe('Buenas tardes')
    expect(greetingFor(19)).toBe('Buenas noches')
    expect(greetingFor(0)).toBe('Buenas noches')
    expect(greetingFor(4)).toBe('Buenas noches')
    expect(greeting('Daniela Ríos Medina', NOW)).toBe('Buenos días, Daniela')
    expect(greeting('Daniela Ríos', '2026-10-04T01:30:00Z')).toBe('Buenas noches, Daniela')
  })

  it('names the day and the team separately (date text, team pill)', () => {
    expect(headerLine('2026-10-03T22:00:00Z', 'Equipo Andes')).toEqual({
      date: 'Sábado 3 de octubre',
      team: 'Equipo Andes',
    })
    expect(headerLine('2026-10-03T22:00:00Z', null).team).toBeNull()
  })
})

describe('availability block', () => {
  it('paused: the state, short facts and "Empezar a atender"', () => {
    expect(availabilityBlockCopy('paused', { openCases: 4 })).toEqual({
      title: 'Estás en pausa',
      facts: [
        { key: 'new', icon: 'pause', text: 'Sin casos nuevos', tone: 'warn' },
        { key: 'open', icon: 'inbox', text: '4 casos abiertos' },
      ],
      action: 'Empezar a atender',
      tone: 'warn',
    })
    expect(texts(availabilityBlockCopy('paused', { openCases: 1 }).facts)).toEqual([
      'Sin casos nuevos',
      '1 caso abierto',
    ])
    expect(texts(availabilityBlockCopy('paused', { openCases: null }).facts)).toEqual([
      'Sin casos nuevos',
    ])
  })

  it('available: "Pausar casos nuevos"', () => {
    expect(availabilityBlockCopy('available', { openCases: 0 })).toEqual({
      title: 'Estás disponible',
      facts: [
        { key: 'new', icon: 'check', text: 'Recibes casos nuevos', tone: 'success' },
        { key: 'open', icon: 'inbox', text: '0 casos abiertos' },
      ],
      action: 'Pausar casos nuevos',
      tone: 'success',
    })
  })
})

describe('status tiles', () => {
  it('lists the four statuses in canvas order with their tones, counts and Casos links', () => {
    expect(statusTiles(makeCounts())).toEqual([
      {
        status: 'to_reply',
        label: 'Por responder',
        tone: 'warn',
        shape: 'pie-75',
        count: 2,
        href: '/analista?estado=por-responder',
      },
      {
        status: 'new',
        label: 'Nuevos',
        tone: 'accent',
        shape: 'ring',
        count: 2,
        href: '/analista?estado=nuevos',
      },
      {
        status: 'waiting',
        label: 'Esperando al cliente',
        tone: 'waiting',
        shape: 'pie-50',
        count: 1,
        href: '/analista?estado=esperando',
      },
      {
        status: 'closed',
        label: 'Cerrados',
        tone: 'closed',
        shape: 'check',
        count: 3,
        href: '/analista?estado=cerrados',
      },
    ])
    expect(statusTiles(undefined).map((tile) => tile.count)).toEqual([null, null, null, null])
  })
})

describe('Lo primero', () => {
  it('orders her open cases by urgency (the shared order) and links each to Casos', () => {
    const rows = firstCases(seededInbox, NOW)
    expect(rows.map((row) => row.name)).toEqual([
      'Beatriz Salcedo Prieto',
      'Patricia Lozano Vega',
      'Larissa Monteiro Alves',
      'Marcela Quintana Pardo',
      'Joaquín Ferreyra Paz',
    ])
    const [beatriz, patricia, larissa, marcela, joaquin] = rows
    expect(beatriz).toMatchObject({
      status: { shape: 'pie-75', label: 'Por responder', tone: 'warn' },
      sla: { icon: 'flame', text: '3 min', tone: 'warn', tooltip: 'Vence en 3 min' },
      href: '/analista?caso=CASE-00000000000000000000000102&estado=por-responder',
    })
    expect(texts(beatriz!.facts)).toEqual(['Chat en la app'])
    expect(beatriz!.facts[0]).toMatchObject({ icon: 'message', iconOnly: true })
    expect(texts(patricia!.facts)).toEqual(['Chat en la app', 'Volvió a escribir'])
    // No language in a case summary: it shows only in the customer file.
    expect(texts(larissa!.facts)).toEqual(['Chat web'])
    expect(larissa!.sla).toMatchObject({ icon: 'clock', text: '13 min', tone: 'muted' })
    expect(marcela).toMatchObject({ sla: null, last: { icon: 'clock', text: 'hace 2 min' } })
    expect(joaquin).toMatchObject({
      status: { shape: 'pie-50', label: 'Esperando al cliente', tone: 'waiting' },
      preview: 'Tú: Hola, Joaquín. Soy Daniela, de LATAM Bank.',
      last: { text: 'hace 40 min', tooltip: 'Sin respuesta del cliente' },
      href: '/analista?caso=CASE-00000000000000000000000107&estado=esperando',
    })
  })

  it('says SLA vencido, flags a high priority, leaves closed cases out and caps the list', () => {
    const overdue = makeCaseSummary({
      id: 'CASE-OVERDUE',
      firstResponseAt: null,
      slaDueAt: minutesFrom(-1),
      priority: 'high',
    })
    const closed = makeCaseSummary({ id: 'CASE-CLOSED', status: 'closed', inboxStatus: 'closed' })
    const rows = firstCases([closed, ...seededInbox, overdue], NOW, 3)
    expect(rows.map((row) => row.id)).toEqual([
      'CASE-OVERDUE',
      'CASE-00000000000000000000000102',
      'CASE-00000000000000000000000108',
    ])
    expect(rows[0]!.sla).toMatchObject({
      icon: 'flame-filled',
      text: 'Vencido',
      tone: 'danger',
      label: 'SLA de primera respuesta',
      tooltip: 'Primera respuesta vencida',
    })
    expect(rows[0]!.facts.map((fact) => fact.key)).toEqual(['channel', 'priority'])
    expect(rows[0]!.facts[1]).toMatchObject({ icon: 'priority-high', text: 'Prioridad alta' })
  })

  it('marks an escalated case with "Escalado", like the Casos card (slice 9)', () => {
    const marcela = seededInbox.find((item) => item.id.endsWith('101'))!
    const items = [
      ...seededInbox.filter((item) => item !== marcela),
      { ...marcela, escalated: true },
    ]
    const rows = firstCases(items, NOW, 10)
    const escalated = rows.find((row) => row.name === 'Marcela Quintana Pardo')!
    expect(escalated.escalated).toEqual({ shape: 'up', tone: 'warn', label: 'Escalado' })
    expect(rows.filter((row) => row.escalated !== null)).toHaveLength(1)
  })

  it('puts critical and high right after the overdue ones (slice 8)', () => {
    const marcela = seededInbox.find((item) => item.id.endsWith('101'))!
    const joaquin = seededInbox.find((item) => item.id.endsWith('107'))!
    const overdue = makeCaseSummary({
      id: 'CASE-OVERDUE',
      firstResponseAt: null,
      slaDueAt: minutesFrom(-1),
    })
    const items = [
      ...seededInbox.filter((item) => item !== marcela && item !== joaquin),
      { ...marcela, priority: 'high' as const },
      { ...joaquin, priority: 'critical' as const }, // waiting for the customer: stays last
      overdue,
    ]
    const rows = firstCases(items, NOW, 10)
    expect(rows.map((row) => row.name)).toEqual([
      overdue.customer.displayName,
      'Marcela Quintana Pardo',
      'Beatriz Salcedo Prieto',
      'Patricia Lozano Vega',
      'Larissa Monteiro Alves',
      'Joaquín Ferreyra Paz',
    ])
    expect(rows[1]!.facts.at(-1)).toMatchObject({ key: 'priority', icon: 'priority-high' })
  })
})

describe('Mientras no estabas · templates', () => {
  const template = (overrides: Parameters<typeof makeActivityItem>[0]) =>
    activityTemplate(makeActivityItem(overrides), NOW)

  it('arrival on rule 3: the language, and the "Regla 3" tag only for Portuguese', () => {
    expect(template({ kind: 'assigned_on_arrival', language: 'es' })).toEqual({
      phrase: 'Te llegó',
      status: null,
      facts: [{ key: 'language', icon: 'languages', text: 'Español', label: 'Por idioma' }],
      lastCloseReason: null,
    })
    expect(template({ kind: 'assigned_on_arrival', language: 'pt' }).facts).toEqual([
      {
        key: 'language',
        icon: 'languages',
        text: 'Portugués',
        label: 'Por idioma',
        tag: 'Regla 3',
      },
    ])
    expect(languageFact('es').tag).toBeUndefined()
  })

  it('from the queue: the wait in whole minutes', () => {
    const fromQueue = template({ kind: 'assigned_from_queue', waitedSeconds: 17 * 60 + 20 })
    expect(fromQueue.phrase).toBe('Te llegó desde la cola')
    expect(fromQueue.facts).toEqual([{ key: 'waited', icon: 'hourglass', text: 'Esperó 17 min' }])
    expect(texts(template({ kind: 'assigned_from_queue', waitedSeconds: 20 }).facts)).toEqual([
      'Esperó 1 min',
    ])
    expect(template({ kind: 'assigned_from_queue', waitedSeconds: null }).facts).toEqual([])
  })

  it('a supervisor assigned it to her: who, the status and the SLA', () => {
    const given = template({
      kind: 'assigned_by_supervisor',
      actorName: 'Lucía Herrera',
      reason: 'manual',
    })
    expect(given.phrase).toBe('Te lo asignaron')
    expect(given.status).toEqual({ shape: 'ring', tone: 'accent', label: 'Nuevo' })
    expect(given.facts).toEqual([
      {
        key: 'by',
        icon: 'users',
        text: 'Lucía Herrera',
        label: 'Asignado por',
        tooltip: 'Asignado por',
      },
      expect.objectContaining({ key: 'sla', icon: 'flame', text: '1 min', tone: 'warn' }),
    ])
    expect(texts(template({ kind: 'assigned_by_supervisor', actorName: null }).facts)[0]).toBe(
      'Supervisión',
    )
  })

  it('reassigned away: who moved it, who has it now, and that she can still read it', () => {
    const away = template({
      kind: 'reassigned_away',
      actorName: 'Lucía Herrera',
      targetName: 'Sebastián Cárdenas',
      readOnly: true,
    })
    expect(away.phrase).toBe('Ya no es tuyo')
    expect(texts(away.facts)).toEqual(['Lucía Herrera', 'Sebastián Cárdenas', 'Solo lectura'])
    expect(away.facts.map((fact) => fact.icon)).toEqual(['users', 'user', 'eye'])
    expect(
      texts(template({ kind: 'reassigned_away', actorName: null, targetName: null }).facts),
    ).toEqual(['Supervisión', 'Otra persona', 'Solo lectura'])
  })

  it('the customer came back: previous cases and the last close reason', () => {
    const back = template({
      kind: 'customer_returned',
      previousCasesCount: 2,
      lastCloseReason: 'resolved',
    })
    expect(back.phrase).toBe('Volvió a escribir')
    expect(back.facts).toEqual([
      { key: 'previous', icon: 'history', text: '2 casos antes', label: 'Casos anteriores' },
    ])
    expect(back.lastCloseReason).toBe('resolved')
    expect(texts(template({ kind: 'customer_returned', previousCasesCount: 1 }).facts)).toEqual([
      '1 caso antes',
    ])
    expect(
      template({ kind: 'customer_returned', previousCasesCount: 0, lastCloseReason: null }).facts,
    ).toEqual([])
  })

  it('customer messages: the count, then the status and the SLA now', () => {
    const messages = template({
      kind: 'customer_messages',
      messageCount: 2,
      caseStatus: 'in_progress',
      inboxStatus: 'to_reply',
    })
    expect(messages.phrase).toBe('Escribió 2 mensajes')
    expect(messages.status).toEqual({
      shape: 'pie-75',
      tone: 'warn',
      label: 'Por responder',
      strong: true,
    })
    expect(texts(messages.facts)).toEqual(['1 min'])
    expect(template({ kind: 'customer_messages', messageCount: 1 }).phrase).toBe(
      'Escribió 1 mensaje',
    )
    const answered = template({
      kind: 'customer_messages',
      caseStatus: 'in_progress',
      inboxStatus: 'waiting',
      firstResponseAt: minutesFrom(-5),
    })
    expect(answered.status).toEqual({
      shape: 'pie-50',
      tone: 'waiting',
      label: 'Esperando al cliente',
    })
    expect(answered.facts).toEqual([])
  })

  it('has a template for every kind, and no fact joins words with "·"', () => {
    const kinds: HomeActivityKind[] = [
      'assigned_on_arrival',
      'assigned_from_queue',
      'assigned_by_supervisor',
      'reassigned_away',
      'customer_returned',
      'customer_messages',
    ]
    for (const kind of kinds) {
      const row = template({ kind, previousCasesCount: 1, waitedSeconds: 60 })
      expect(row.phrase).not.toBe('')
      expect([row.phrase, ...texts(row.facts)].join(' ')).not.toContain('·')
    }
  })
})

describe('Mientras no estabas · rows', () => {
  it('builds the canvas rows: icon, customer, phrase, time and link', () => {
    const rows = canvasFeed.map((item) => activityRow(item, NOW))
    expect(
      rows.map((row) => [row.icon, row.customerName, row.phrase, row.when, row.href, row.readOnly]),
    ).toEqual([
      [
        'msg',
        'Beatriz Salcedo Prieto',
        'Escribió 2 mensajes',
        'hace 2 min',
        '/analista?caso=CASE-00000000000000000000000102&estado=por-responder',
        false,
      ],
      [
        'out',
        'Marcela Quintana Pardo',
        'Ya no es tuyo',
        'hace 6 min',
        // Read-only: no filter (it is in none of her lists).
        '/analista?caso=CASE-00000000000000000000000101',
        true,
      ],
      [
        'in',
        'Larissa Monteiro Alves',
        'Te llegó',
        'hace 14 min',
        '/analista?caso=CASE-00000000000000000000000103&estado=nuevos',
        false,
      ],
      [
        'back',
        'Patricia Lozano Vega',
        'Volvió a escribir',
        'hace 15 min',
        '/analista?caso=CASE-00000000000000000000000108&estado=nuevos',
        false,
      ],
      [
        'in',
        'Rosa Elena Ibarra Méndez',
        'Te llegó desde la cola',
        'hace 20 min',
        '/analista?caso=CASE-00000000000000000000000111&estado=nuevos',
        false,
      ],
    ])
    expect(rows[0]!.key).toBe('customer_messages:CASE-00000000000000000000000102')
  })

  it('names a row link with who, what, the facts and the time, and where it goes', () => {
    const [messages, away, , back] = canvasFeed.map((item) => activityRow(item, NOW))
    expect(activityLinkLabel(messages!)).toBe(
      'Beatriz Salcedo Prieto: Escribió 2 mensajes. Por responder, SLA de primera respuesta: 1 min, hace 2 min. Abrir el caso',
    )
    expect(activityLinkLabel(away!)).toBe(
      'Marcela Quintana Pardo: Ya no es tuyo. Lo reasignó: Lucía Herrera, Ahora lo atiende: Sebastián Cárdenas, Solo lectura, hace 6 min. Abrir en solo lectura',
    )
    expect(activityLinkLabel(back!, 'Resuelto')).toBe(
      'Patricia Lozano Vega: Volvió a escribir. Casos anteriores: 2 casos antes, Último cierre: Resuelto, hace 15 min. Abrir el caso',
    )
  })

  it('says since when: today, yesterday, an older day, or the 8-hour fallback', () => {
    const now = '2026-10-03T22:00:00Z' // 17:00 in Bogotá
    const since = (value: string) =>
      sinceFacts({ since: value, sinceSource: 'previous_session' }, now)
    expect(since('2026-10-03T16:20:00Z')).toEqual([
      { key: 'logout', icon: 'log-out', text: 'Cerraste sesión' },
      { key: 'since', icon: 'clock', text: 'hoy 11:20', label: 'Desde' },
    ])
    expect(texts(since('2026-10-02T23:05:00Z'))).toEqual(['Cerraste sesión', 'ayer 18:05'])
    expect(texts(since('2026-09-28T23:05:00Z'))).toEqual(['Cerraste sesión', '28 sep, 18:05'])
    expect(sinceFacts({ since: '2026-10-03T14:00:00Z', sinceSource: 'fallback' }, now)).toEqual([
      {
        key: 'since',
        icon: 'clock',
        text: 'Últimas 8 horas',
        tooltip: 'No hay una sesión tuya anterior',
      },
    ])
  })

  it('offers "Ver todo (n)" only when rows are hidden, and notes the server cap', () => {
    expect(feedToggleLabel(4, 5, false)).toBe('Ver todo (5)')
    expect(feedToggleLabel(4, 4, false)).toBeNull()
    expect(feedToggleLabel(5, 5, true)).toBe('Ver menos')
    expect(feedTruncatedNote(10, 14)).toBe('Se muestran las 10 más recientes de 14.')
    expect(feedTruncatedNote(5, 5)).toBeNull()
    expect(EMPTY_FEED_COPY).toBe('Nada nuevo desde tu última sesión')
  })
})

describe('Tu equipo ahora', () => {
  const team = makeHome().teamNow

  it('counts the available analysts of her team, tagging her when she is one', () => {
    expect(availableValue(team)).toBe('0 de 4')
    const [mine] = teamRows({ ...team, availableCount: 1 }, true, NOW)
    expect(mine).toMatchObject({ label: 'Disponibles', value: '1 de 4', tag: 'Tú' })
  })

  it('shows each queue of her languages with its own oldest-wait fact', () => {
    expect(teamRows(team, false, NOW)).toEqual([
      {
        key: 'available',
        icon: 'users',
        label: 'Disponibles',
        value: '0 de 4',
        tag: null,
        wait: null,
      },
      {
        key: 'queue-es',
        icon: 'inbox',
        label: 'Cola en español',
        value: '2',
        tag: null,
        wait: {
          key: 'wait',
          icon: 'clock',
          text: 'hace 17 min',
          label: 'El más antiguo',
          tooltip: 'El más antiguo',
          tone: 'muted',
        },
      },
      expect.objectContaining({ label: 'Cola en portugués', value: '1' }),
    ])
    expect(queueWait({ language: 'es', waiting: 0, oldestQueuedAt: null }, NOW)).toBeNull()
  })
})
