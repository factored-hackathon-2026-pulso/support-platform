import { describe, expect, it } from 'vitest'
import { makeTurn, seededTurns } from '@/test/conversation-fixtures'
import { setTestLocale } from '@/test/render'
import {
  emptyTranscript,
  mergeTurns,
  staffLineText,
  toTranscriptItems,
  turnText,
  type StaffLine,
} from './model'

/** Slice 23c: staff-only lines written from their facts in the viewer's language. */
const line = (kind: StaffLine['kind'], params: StaffLine['params']): StaffLine => ({
  kind,
  params,
})

const LINES: readonly [StaffLine, string, string][] = [
  [
    line('assigned_on_arrival', { analyst: 'Daniela Ríos', language: 'es' }),
    'Asignado a Daniela Ríos porque está disponible y habla español.',
    'Atribuído a Daniela Ríos porque está disponível e fala espanhol.',
  ],
  [
    line('assigned_on_arrival', { analyst: 'Julián Ortega', language: 'pt' }),
    'Asignado a Julián Ortega porque está disponible y habla portugués (regla 3).',
    'Atribuído a Julián Ortega porque está disponível e fala português (regra 3).',
  ],
  [
    line('assigned_from_assistant', { analyst: 'Daniela Ríos', language: 'es' }),
    'Asignado a Daniela Ríos tras el traspaso del asistente: está disponible y habla español.',
    'Atribuído a Daniela Ríos após a transferência do assistente: está disponível e fala espanhol.',
  ],
  [
    line('queued', { language: 'pt' }),
    'No hay personas disponibles que hablen portugués: el caso espera en la cola en portugués.',
    'Não há pessoas disponíveis que falem português: o caso aguarda na fila em português.',
  ],
  [
    line('assigned_from_queue', { analyst: 'Julián Ortega', minutes: 4, language: 'es' }),
    'Asignado a Julián Ortega después de 4 min en la cola en español.',
    'Atribuído a Julián Ortega depois de 4 min na fila em espanhol.',
  ],
  [
    line('assigned_by_supervision', {
      supervisor: 'Lucía Herrera',
      analyst: 'Tomás Arango',
      minutes: 3,
      language: 'es',
      paused: 'Tomás',
    }),
    'Lucía Herrera asignó el caso a Tomás Arango después de 3 min en la cola en español (Tomás estaba en pausa).',
    'Lucía Herrera atribuiu o caso a Tomás Arango depois de 3 min na fila em espanhol (Tomás estava em pausa).',
  ],
  [
    line('reassigned', {
      supervisor: 'Lucía Herrera',
      previous: 'Paula Medina',
      analyst: 'Julián Ortega',
    }),
    'Lucía Herrera pasó el caso de Paula Medina a Julián Ortega.',
    'Lucía Herrera reatribuiu o caso de Paula Medina para Julián Ortega.',
  ],
  [
    line('escalated', { analyst: 'Daniela Ríos' }),
    'Daniela Ríos escaló el caso a supervisión.',
    'Daniela Ríos escalou o caso para a supervisão.',
  ],
  [
    line('escalation_withdrawn', { analyst: 'Daniela Ríos' }),
    'Daniela Ríos retiró el escalamiento.',
    'Daniela Ríos retirou o escalonamento.',
  ],
  [
    line('escalation_answered', { supervisor: 'Lucía Herrera' }),
    'Lucía Herrera respondió el escalamiento.',
    'Lucía Herrera respondeu ao escalonamento.',
  ],
  [
    line('escalation_taken', { supervisor: 'Felipe Echeverri', previous: 'Daniela Ríos' }),
    'Felipe Echeverri tomó el caso de Daniela Ríos.',
    'Felipe Echeverri assumiu o caso de Daniela Ríos.',
  ],
  [
    line('assistant_released', { reason: 'escalated', ref: 'HND-7' }),
    'El asistente escaló el caso a una persona (traspaso HND-7).',
    'O assistente escalou o caso para uma pessoa (transferência HND-7).',
  ],
  [
    line('assistant_released', { reason: 'supervision' }),
    'Supervisión tomó el caso del asistente.',
    'Supervisão assumiu o caso do assistente.',
  ],
  [
    line('assistant_released', { reason: 'something_new' }),
    'El asistente no pudo seguir atendiendo (sin detalle). El caso pasa a una persona.',
    'O assistente não conseguiu continuar o atendimento (sem detalhe). O caso passa para uma pessoa.',
  ],
  [
    line('follow_up_call', { analyst: 'Daniela Ríos', customer: 'Claudia' }),
    'Daniela Ríos abrió este caso para llamar a Claudia (seguimiento).',
    'Daniela Ríos abriu este caso para ligar para Claudia (acompanhamento).',
  ],
]

describe('staff-only lines from their facts (slice 23c)', () => {
  it('writes every kind in Spanish, as the server stores it', () => {
    for (const [facts, spanish] of LINES) expect(staffLineText(facts)).toBe(spanish)
  })

  it('writes every kind in Brazilian Portuguese', () => {
    setTestLocale('pt-BR')
    for (const [facts, , portuguese] of LINES) expect(staffLineText(facts)).toBe(portuguese)
  })

  it('shows the previous closing in the viewer zone and the close reason in her language', () => {
    const facts = line('wrote_again', {
      customer: 'Patricia',
      closedAt: '2026-03-01T14:05:00Z',
      closeReason: 'customer_unresponsive',
      channel: 'phone_inbound',
    })
    expect(staffLineText(facts)).toMatch(
      /^Patricia volvió a llamar\. Su caso anterior se cerró el .+ \(el cliente no respondió\)\.$/,
    )
    setTestLocale('pt-BR')
    expect(staffLineText({ ...facts, params: { ...facts.params, channel: 'chat_web' } })).toMatch(
      /^Patricia voltou a escrever\. O caso anterior foi encerrado em .+ \(o cliente não respondeu\)\.$/,
    )
  })

  it('falls back to the stored text when the facts are missing or not understood', () => {
    const stored = 'Asignado a Daniela Ríos porque está disponible y habla español.'
    setTestLocale('pt-BR')
    expect(turnText(makeTurn({ kind: 'routing', text: stored }))).toBe(stored)
    const broken = makeTurn({
      kind: 'routing',
      text: stored,
      staffLine: line('assigned_on_arrival', { language: 'es' }),
    })
    expect(turnText(broken)).toBe(stored)
    expect(staffLineText(line('wrote_again', { customer: 'Ana', closedAt: 'never' }))).toBeNull()
  })

  it('puts the line in the transcript in the viewer language; other turns keep their text', () => {
    const turns = seededTurns()
    turns[2] = {
      ...turns[2]!,
      staffLine: line('assigned_on_arrival', { analyst: 'Daniela Ríos', language: 'es' }),
    }
    const cache = mergeTurns(emptyTranscript(), turns)
    setTestLocale('pt-BR')
    const items = toTranscriptItems(cache, 'STF-ME')
    expect(items[2]).toMatchObject({
      variant: 'routing',
      text: 'Atribuído a Daniela Ríos porque está disponível e fala espanhol.',
    })
    expect(items[0]?.text).toBe(turns[0]?.text)
    expect(items[1]?.text).toBe(turns[1]?.text) // a customer notice is chat content
  })

  it('names the virtual assistant in the viewer language', () => {
    const reply = makeTurn({
      authorRole: 'assistant',
      authorId: 'agent',
      authorName: 'Asistente virtual',
      text: 'Olá!',
    })
    setTestLocale('pt-BR')
    expect(toTranscriptItems(mergeTurns(emptyTranscript(), [reply]), 'STF-ME')[0]?.author).toBe(
      'Assistente virtual',
    )
  })
})
