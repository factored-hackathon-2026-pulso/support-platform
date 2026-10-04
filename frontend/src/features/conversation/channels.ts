/**
 * Channel rules of the Workspace (slice 12, docs/platform/api/slice-12-channels.md): which
 * central panel a case shows (chat, call, email), the call's status, timer and controls, the
 * call transcript's times and system lines, the email thread and the copy of their failures.
 * Pure and unit-tested (channels.test.ts); no React, no I/O.
 */
import type { FactItem, StatusAppearance } from '@/components/ui'
import { caseChannel } from '@/features/cases/core'
import { isApiProblem } from '@/lib/api'
import { formatTimer } from '@/lib/format'
import type {
  Call,
  CallDirection,
  CallList,
  CallState,
  CaseDetail,
  CaseSummary,
  EmailMessage,
  Language,
  Turn,
} from './types'

// ── Which central panel ──────────────────────────────────────────────────────

/** The central panel of the Workspace: the same screen, only the center changes. */
export type CenterMode = 'chat' | 'call' | 'email'

/**
 * A live call takes the center whatever the channel (a chat customer who calls, an analyst
 * who calls back); otherwise the channel the case opened by decides, except that a chat whose
 * customer last wrote an email is answered by email (an email joins the open case).
 */
export function centerMode(
  detail: Pick<CaseDetail, 'case' | 'activeCall'>,
  turns: readonly Pick<Turn, 'kind' | 'authorRole'>[] = [],
): CenterMode {
  if (detail.activeCall && isActiveCall(detail.activeCall)) return 'call'
  const kind = caseChannel(detail.case.channel).kind
  if (kind === 'phone') return 'call'
  if (kind === 'email') return 'email'
  const written = turns.findLast(
    (turn) => turn.authorRole === 'customer' && (turn.kind === 'message' || turn.kind === 'email'),
  )
  return written?.kind === 'email' ? 'email' : 'chat'
}

// ── Calls ────────────────────────────────────────────────────────────────────

/** Linear-style glyph + word of each call state (the call bar). */
export const CALL_STATUS: Readonly<Record<CallState, StatusAppearance>> = {
  ringing: { shape: 'ring', tone: 'accent', label: 'Sonando', strong: true },
  in_call: { shape: 'dot', tone: 'success', label: 'En llamada', strong: true },
  on_hold: { shape: 'pause', tone: 'warn', label: 'En espera', strong: true },
  ended: { shape: 'check', tone: 'neutral', label: 'Llamada terminada' },
}

export function isActiveCall(call: Pick<Call, 'state'>): boolean {
  return call.state !== 'ended'
}

function seconds(from: string, to: Date | string | number): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000))
}

/**
 * The live timer, from the call's own times: ringing counts from `startedAt`, a call
 * someone answered from `answeredAt` (holds included, as the backend's duration), an
 * ended call shows its duration (or how long it rang).
 */
export function callElapsedSeconds(
  call: Pick<Call, 'state' | 'startedAt' | 'answeredAt' | 'endedAt' | 'durationSeconds'>,
  now: Date | string | number,
): number {
  if (call.state === 'ended') {
    if (call.durationSeconds !== null) return call.durationSeconds
    return call.endedAt ? seconds(call.startedAt, call.endedAt) : 0
  }
  return seconds(call.answeredAt ?? call.startedAt, now)
}

/** "45 s", "6 min 12 s", "1 h 02 min". */
export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`
  const minutes = Math.floor(s / 60)
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

/**
 * The call bar's state word: the state, and once it ended how ("Llamada terminada, 6 min
 * 12 s", "Llamada sin respuesta", "Llamada rechazada").
 */
export function callStateLabel(
  call: Pick<Call, 'state' | 'endReason' | 'durationSeconds' | 'answeredAt'>,
): string {
  if (call.state !== 'ended') return CALL_STATUS[call.state].label
  if (call.endReason === 'rejected') return 'Llamada rechazada'
  if (call.endReason === 'cancelled' || call.answeredAt === null) return 'Llamada sin respuesta'
  return call.durationSeconds !== null
    ? `Llamada terminada, ${formatCallDuration(call.durationSeconds)}`
    : 'Llamada terminada'
}

/** The direction as a fact: phone with an arrow in / out, "Entrante" / "Saliente". */
export function callDirectionFact(direction: CallDirection): FactItem {
  const outbound = direction === 'outbound'
  return {
    key: 'direction',
    icon: outbound ? 'phone-outgoing' : 'phone-incoming',
    text: outbound ? 'Saliente' : 'Entrante',
    tooltip: outbound ? 'Llamada saliente' : 'Llamada entrante',
    tone: 'muted',
  }
}

export interface CallControls {
  /** "Contestar": an inbound call ringing (the customer answers an outbound one). */
  answer: boolean
  /** "Poner en espera" while talking, "Retomar" while on hold. */
  hold: boolean
  resume: boolean
  /** "Silenciar" (toggle) while talking or on hold. */
  mute: boolean
  /** "Colgar": any active call (while ringing it cancels it). */
  hangUp: boolean
}

const NO_CONTROLS: CallControls = {
  answer: false,
  hold: false,
  resume: false,
  mute: false,
  hangUp: false,
}

/** The buttons of the call bar for the person who may act on it (the assignee). */
export function callControls(call: Pick<Call, 'state' | 'direction'>, canAct: boolean) {
  if (!canAct) return NO_CONTROLS
  switch (call.state) {
    case 'ringing':
      return { ...NO_CONTROLS, answer: call.direction === 'inbound', hangUp: true }
    case 'in_call':
      return { ...NO_CONTROLS, hold: true, mute: true, hangUp: true }
    case 'on_hold':
      return { ...NO_CONTROLS, resume: true, mute: true, hangUp: true }
    default:
      return NO_CONTROLS
  }
}

/** Whether `incoming` is a fresher version of the same call. */
export function isNewerCall(incoming: Pick<Call, 'id' | 'version'>, current: Call | null) {
  return !current || current.id !== incoming.id || incoming.version > current.version
}

/** The calls list with this call in it (replaced only by a newer version), most recent first. */
export function upsertCall(list: CallList | undefined, call: Call): CallList {
  const items = list?.items ?? []
  const current = items.find((item) => item.id === call.id) ?? null
  if (current && !isNewerCall(call, current)) return list as CallList
  const next = [call, ...items.filter((item) => item.id !== call.id)].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
  return { items: next, serverTime: list?.serverTime ?? new Date().toISOString() }
}

/**
 * The detail's active call after this call changed: an active call takes the slot (when it
 * is newer than what is there), an ended one leaves it.
 */
export function applyCallToDetail(detail: CaseDetail, call: Call): CaseDetail {
  if (detail.case.id !== call.caseId) return detail
  const current = detail.activeCall
  if (current && current.id === call.id && !isNewerCall(call, current)) return detail
  if (isActiveCall(call)) return { ...detail, activeCall: call }
  if (current?.id === call.id) return { ...detail, activeCall: null }
  return detail
}

/** The call the bar shows: the active one, else the most recent one (call panel only). */
export function barCall(
  detail: Pick<CaseDetail, 'activeCall'>,
  calls: readonly Call[] | undefined,
): Call | null {
  return detail.activeCall ?? calls?.[0] ?? null
}

/** The reason of an outbound call ("Por qué llamas"), or null. */
export function outboundReason(call: Pick<Call, 'direction' | 'reason'> | null): string | null {
  return call?.direction === 'outbound' && call.reason ? call.reason : null
}

/** "Transcripción en vivo" while a call is on, else "Transcripción". */
export function transcriptCaption(call: Pick<Call, 'state'> | null): string {
  return call && isActiveCall(call) ? 'Transcripción en vivo' : 'Transcripción'
}

/** The call a transcript line belongs to (lines are written between a call's start and end). */
export function callForTime(calls: readonly Call[], createdAt: string): Call | null {
  const at = new Date(createdAt).getTime()
  for (const call of calls) {
    const start = new Date(call.startedAt).getTime()
    const end = call.endedAt ? new Date(call.endedAt).getTime() : Number.POSITIVE_INFINITY
    if (at >= start && at <= end) return call
  }
  return null
}

/** "02:41": the time of a line inside its call (from the answer, or from the ring). */
export function lineOffset(call: Pick<Call, 'startedAt' | 'answeredAt'>, createdAt: string) {
  return formatTimer(seconds(call.answeredAt ?? call.startedAt, createdAt))
}

/** The kind of a system line of a call (the backend's fixed texts, both languages). */
export type CallEventKind = 'hold' | 'resume' | 'end'

const CALL_EVENT_TEXTS: Readonly<Record<string, CallEventKind>> = {
  'Llamada en espera.': 'hold',
  'Chamada em espera.': 'hold',
  'La llamada continúa.': 'resume',
  'A chamada continua.': 'resume',
  'La llamada terminó.': 'end',
  'A chamada terminou.': 'end',
  'La llamada terminó sin respuesta.': 'end',
  'A chamada terminou sem resposta.': 'end',
}

export function callEventKind(text: string): CallEventKind {
  return CALL_EVENT_TEXTS[text.trim()] ?? 'end'
}

export const MAX_CALL_REASON = 500

/** "Motivo" of "Llamar al cliente": required, at most 500 characters. */
export function validateCallReason(reason: string): string | null {
  const length = reason.trim().length
  if (length === 0) return 'Escribe por qué llamas.'
  if (length > MAX_CALL_REASON) return 'El motivo puede tener hasta 500 caracteres.'
  return null
}

/** What a failed call command means for the analyst. */
export function describeCallFailure(error: unknown): string {
  if (isApiProblem(error, 'call_in_progress')) return 'Ya hay una llamada en curso en este caso.'
  if (isApiProblem(error, 'call_not_active')) return 'La llamada ya terminó.'
  if (isApiProblem(error, 'invalid_transition')) {
    return 'La llamada cambió de estado. Revisa la barra de la llamada.'
  }
  if (isApiProblem(error, 'case_closed')) return 'Este caso ya está cerrado.'
  if (isApiProblem(error, 'case_not_assigned')) {
    return 'Ya no puedes hacerlo: supervisión pasó este caso a otra persona.'
  }
  if (isApiProblem(error, 'network_error')) return 'No hay conexión. Inténtalo de nuevo.'
  return 'No pudimos completar la acción. Inténtalo de nuevo.'
}

/** A line, a note or an email that did not go out. */
export function describeWriteFailure(error: unknown): string {
  if (isApiProblem(error, 'call_not_active') || isApiProblem(error, 'invalid_transition')) {
    return 'La llamada no está activa: no se guardó lo que dijiste.'
  }
  if (isApiProblem(error, 'case_closed')) return 'Este caso ya está cerrado.'
  if (isApiProblem(error, 'case_not_assigned')) {
    return 'Ya no puedes escribir: supervisión pasó este caso a otra persona.'
  }
  if (isApiProblem(error, 'invalid_value')) return 'Escribe el asunto del correo.'
  if (isApiProblem(error, 'validation_error')) return 'Revisa el texto: es muy largo o está vacío.'
  if (isApiProblem(error, 'network_error')) return 'No hay conexión. Inténtalo de nuevo.'
  return 'No se envió. Inténtalo de nuevo.'
}

// ── Email ────────────────────────────────────────────────────────────────────

/** The thread's subject: the first email's (the backend threads per case). */
export function threadSubject(turns: readonly Pick<Turn, 'kind' | 'subject'>[]): string | null {
  return turns.find((turn) => turn.kind === 'email' && turn.subject)?.subject ?? null
}

/** "Re: Cobro duplicado", never "Re: Re: …" (as the backend frames it). */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`
}

/**
 * The customer's emails nobody answered yet (after the last email of the bank): marked
 * "Nuevo" and open in the thread.
 */
export function unansweredEmailIds(
  turns: readonly Pick<Turn, 'id' | 'kind' | 'authorRole'>[],
): Set<string> {
  const ids = new Set<string>()
  for (const turn of turns) {
    if (turn.kind !== 'email') continue
    if (turn.authorRole === 'customer') ids.add(turn.id)
    else ids.clear()
  }
  return ids
}

/** One line of an email for its collapsed row. */
export function emailSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The reply as a turn of the case (the POST answers an `EmailMessage`). */
export function emailToTurn(email: EmailMessage, language: Language): Turn {
  return {
    id: email.id,
    caseId: email.caseId,
    sequence: email.sequence,
    kind: 'email',
    audience: 'everyone',
    authorRole: email.authorRole,
    authorId: email.authorId,
    authorName: email.authorName,
    text: email.body,
    subject: email.subject,
    language,
    createdAt: email.createdAt,
    clientMessageId: email.clientMessageId,
  }
}

/** The whole "Para" is hidden: the platform exposes no address (a simulated mailbox). */
export const MASKED_ADDRESS = '•••••@•••••'

// ── Close dialog ─────────────────────────────────────────────────────────────

/** How the closing notice reaches the customer: on screen (chat), by email, or not (call). */
export function closeNoticeChannel(summary: Pick<CaseSummary, 'channel'>): CenterMode {
  const kind = caseChannel(summary.channel).kind
  return kind === 'phone' ? 'call' : kind === 'email' ? 'email' : 'chat'
}
