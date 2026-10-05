/**
 * The shared case vocabulary follows the UI language (slice 23): every area reads these maps
 * and helpers, and they read the `cases` catalog at call time, so a language switch changes
 * them without any caller doing anything.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { NOW, makeCaseSummary } from '@/test/case-fixtures'
import { setTestLocale } from '@/test/render'
import {
  CASE_STATUS,
  CASE_TYPE_OPTIONS,
  CLOSE_REASONS,
  ESCALATED_MARKER,
  ESCALATION_STATE,
  INBOX_FILTERS,
  OPEN_CASE_STATUS,
  PRIORITY_OPTIONS,
  RATING_SCALE,
  RETURNED_TAG,
  WITH_ASSISTANT_STATUS,
  availabilityControlCopy,
  caseCardFacts,
  caseLifecycleStatus,
  caseStatus,
  caseType,
  caseTypeMenuLabel,
  channelFact,
  channelLabel,
  closeReasonLabel,
  closeReasonOption,
  countryName,
  emptyListCopy,
  escalationWaitFact,
  filterChipLabel,
  formatSla,
  inboxStatusMeta,
  priorityFact,
  priorityLabel,
  priorityMenuLabel,
  ratingFact,
  ratingLabel,
  slaFact,
} from './model'

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()
const sla = (minutes: number) =>
  formatSla({ status: 'in_progress', slaDueAt: at(minutes), firstResponseAt: null }, NOW)

describe('shared case vocabulary in Portuguese', () => {
  beforeEach(() => setTestLocale('pt-BR'))

  it('names every status, filter and bucket', () => {
    expect(caseStatus('to_reply')).toEqual({
      shape: 'pie-75',
      tone: 'warn',
      label: 'A responder',
      strong: true,
    })
    expect(caseStatus(null).label).toBe('Sem responsável')
    expect(CASE_STATUS.closed).toMatchObject({ label: 'Encerrado', bucket: 'Encerrados' })
    expect(inboxStatusMeta({ inboxStatus: 'waiting' })).toMatchObject({
      label: 'Aguardando o cliente',
      subLabel: 'Aguardando o cliente',
    })
    expect(INBOX_FILTERS.map((filter) => filter.label)).toEqual([
      'Todos',
      'A responder',
      'Novos',
      'Aguardando o cliente',
      'Encerrados',
    ])
    expect(filterChipLabel('new')).toBe('Novos')
    expect(caseLifecycleStatus('in_progress').label).toBe('Aberto')
    expect(OPEN_CASE_STATUS.label).toBe('Aberto')
    expect(caseLifecycleStatus('with_assistant')).toBe(WITH_ASSISTANT_STATUS)
    expect(WITH_ASSISTANT_STATUS.label).toBe('Com o assistente')
  })

  it('names channels, priorities and case types', () => {
    expect(channelLabel('chat_app')).toBe('Chat no app')
    expect(channelLabel('phone_inbound')).toBe('Ligação recebida')
    expect(channelLabel('email')).toBe('E-mail')
    expect(channelFact('phone_outbound')).toMatchObject({
      text: 'Ligação efetuada',
      label: 'Canal',
    })
    expect(PRIORITY_OPTIONS.map((option) => option.label)).toEqual([
      'Sem prioridade',
      'Crítica',
      'Alta',
      'Média',
      'Baixa',
    ])
    expect(priorityLabel('high')).toBe('Prioridade alta')
    expect(priorityFact('critical')?.text).toBe('Prioridade crítica')
    expect(priorityMenuLabel('low')).toBe('Prioridade: Baixa. Alterar a prioridade')
    expect(CASE_TYPE_OPTIONS.map((option) => option.label)).toEqual([
      'Sem tipo',
      'Transação não reconhecida',
      'Cobrança indevida',
      'Problema com o app',
      'Atendimento na agência',
      'Qualidade do atendimento',
      'Cartão virtual',
    ])
    expect(caseType('virtual_card').label).toBe('Cartão virtual')
    expect(caseTypeMenuLabel('none')).toBe('Tipo de caso: Sem tipo. Alterar o tipo de caso')
    expect(countryName('CO')).toBe('Colômbia')
    expect(countryName('BR')).toBe('Brasil')
  })

  it('names close reasons and ratings', () => {
    expect(CLOSE_REASONS.map((option) => option.label)).toEqual([
      'Resolvido',
      'O cliente não respondeu',
      'Duplicado',
      'Fora do escopo',
      'Outro',
    ])
    expect(closeReasonOption('other')).toMatchObject({
      label: 'Outro',
      meaning: 'Explique na nota interna.',
      tone: 'neutral',
    })
    expect(closeReasonLabel(null)).toBe('Sem motivo')
    expect(closeReasonLabel('duplicate')).toBe('Duplicado')
    expect(RATING_SCALE.map((option) => option.label)).toEqual([
      'Ruim',
      'Regular',
      'Bom',
      'Excelente',
    ])
    expect(ratingLabel({ score: 3 })).toBe('Bom')
    expect(ratingFact({ score: 1 })?.text).toBe('Avaliação: Ruim')
  })

  it('says the SLA, its tooltips and the card facts', () => {
    expect(sla(9)?.text).toBe('SLA 9 min')
    expect(sla(5 * 60)?.text).toBe('SLA 5 h')
    expect(sla(5 * 24 * 60)?.text).toBe('SLA 5 dias')
    expect(sla(-1)?.text).toBe('SLA vencido')
    const summary = { status: 'in_progress' as const, firstResponseAt: null }
    expect(slaFact({ ...summary, slaDueAt: at(-1) }, NOW)).toMatchObject({
      text: 'Vencido',
      label: 'SLA de primeira resposta',
      tooltip: 'Primeira resposta vencida',
    })
    expect(slaFact({ ...summary, slaDueAt: at(3) }, NOW)?.tooltip).toBe('Vence em 3 min')
    expect(slaFact({ ...summary, slaDueAt: at(12) }, NOW)?.tooltip).toBe(
      'Primeira resposta: vence em 12 min',
    )
    const facts = caseCardFacts(
      makeCaseSummary({
        activeCallId: 'CALL-1',
        previousCaseId: 'CASE-00000000000000000000000001',
      }),
    )
    expect(facts.map((fact) => fact.text)).toContain('Ligação em andamento')
    expect(facts.map((fact) => fact.text)).toContain('Voltou a escrever')
    expect(RETURNED_TAG.title).toBe('Escreveu de novo depois que o caso anterior foi encerrado')
  })

  it('names escalation states and waits', () => {
    expect({ ...ESCALATED_MARKER }).toEqual({ shape: 'up', tone: 'warn', label: 'Escalado' })
    expect(ESCALATION_STATE.taken.label).toBe('Assumido')
    expect(ESCALATION_STATE.reassigned.label).toBe('Reatribuído')
    expect(ESCALATION_STATE.closed.label).toBe('Caso encerrado')
    const open = escalationWaitFact({ escalatedAt: at(-65), resolvedAt: null, state: 'open' }, NOW)
    expect(open).toMatchObject({ text: '1 h 05 min', label: 'Espera' })
    expect(open.tooltip).toBe('Aguardando há 1 h 05 min')
    const answered = escalationWaitFact(
      { escalatedAt: at(-40), resolvedAt: at(-36), state: 'answered' },
      NOW,
    )
    expect(answered).toMatchObject({ label: 'Esperou', tooltip: 'Esperou 4 min' })
  })

  it('words the availability control and the empty list', () => {
    expect(availabilityControlCopy('paused')).toEqual({
      label: 'Em pausa',
      detail: 'Você não recebe casos novos',
      accessibleName: 'Em pausa. Ficar disponível',
    })
    expect(availabilityControlCopy('available').accessibleName).toBe(
      'Disponível. Pausar casos novos',
    )
    expect(emptyListCopy(null, true)).toBe('Nenhum caso corresponde à sua busca.')
    expect(emptyListCopy('closed', false)).toBe('Você não encerrou casos nos últimos 7 dias.')
    expect(emptyListCopy(null, false)).toBe('Nada pendente.')
  })
})

describe('shared case vocabulary follows a language switch', () => {
  it('reads the same map in the language active at each call', () => {
    const marker = ESCALATED_MARKER
    expect(caseStatus('new').label).toBe('Nuevo')
    expect(marker.label).toBe('Escalado')
    expect(CLOSE_REASONS[0]?.meaning).toBe('Se atendió lo que pidió.')
    setTestLocale('pt-BR')
    expect(caseStatus('new').label).toBe('Novo')
    expect(CLOSE_REASONS[0]?.meaning).toBe('O que o cliente pediu foi atendido.')
    expect(sla(48 * 60)?.text).toBe('SLA 2 dias')
    setTestLocale('es')
    expect(caseStatus('new').label).toBe('Nuevo')
    expect(sla(48 * 60)?.text).toBe('SLA 2 días')
    expect(countryName('CO')).toBe('Colombia')
  })
})
