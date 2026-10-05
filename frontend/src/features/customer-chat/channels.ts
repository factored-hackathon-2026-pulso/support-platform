/**
 * Simulator channel rules (slice 12, docs/platform/api/slice-12-channels.md §3.2): which channel
 * the customer picked (`?channel=`), the customer's view of a call (phase, title, timer, lines)
 * and of the email thread, and their copy in the customer's language (es | pt, the `customer`
 * catalog through `customerT`). Pure and unit-tested (channels.test.ts).
 */
import { isApiProblem } from '@/lib/api'
import { assistantActiveMessage } from './assistant'
import { formatTimer } from '@/lib/format'
import { chromeT, customerT } from './locale'
import type {
  CustomerCall,
  CustomerChatCache,
  CustomerConversation,
  CustomerEmail,
  CustomerTurn,
  Language,
} from './types'

// ── The channel picked ───────────────────────────────────────────────────────

/** The channel the customer picked (`?channel=`, url.ts). */
export type SimChannel = 'chat' | 'call' | 'email'

export const SIM_CHANNELS: readonly SimChannel[] = ['chat', 'call', 'email']

export interface ChannelOption {
  value: SimChannel
  /** In the UI language (simulator chrome), read when shown. */
  readonly title: string
  readonly description: string
}

function channelOption(value: SimChannel): ChannelOption {
  return {
    value,
    get title() {
      return chromeT(`channels.option.${value}.title`)
    },
    get description() {
      return chromeT(`channels.option.${value}.description`)
    },
  }
}

/** The three cards of "¿Cómo se comunica {nombre} con el banco?" (simulator chrome). */
export const CHANNEL_OPTIONS: readonly ChannelOption[] = SIM_CHANNELS.map(channelOption)

// ── The call, as the customer lives it ───────────────────────────────────────

/**
 * `dialing`: the customer called and it rings ("Llamando…"); `incoming`: the bank calls
 * ("LATAM Bank te está llamando"); `live` / `hold`: someone answered; `ended`; `none`: no call.
 */
export type CustomerCallPhase = 'none' | 'dialing' | 'incoming' | 'live' | 'hold' | 'ended'

export function customerCallPhase(call: CustomerCall | null): CustomerCallPhase {
  if (!call) return 'none'
  switch (call.state) {
    case 'ringing':
      return call.direction === 'outbound' ? 'incoming' : 'dialing'
    case 'in_call':
      return 'live'
    case 'on_hold':
      return 'hold'
    default:
      return 'ended'
  }
}

/** A call of the bank ringing right now (the banner over any channel). */
export function isIncomingCall(call: CustomerCall | null): call is CustomerCall {
  return customerCallPhase(call) === 'incoming'
}

export function isCustomerCallActive(call: CustomerCall | null): call is CustomerCall {
  return call !== null && call.state !== 'ended'
}

/**
 * Whether `incoming` (a `call.updated` or a command's answer) should replace the cached call:
 * the same call unless it already ended (ended is final), or a call that started later.
 */
export function isNewerCustomerCall(incoming: CustomerCall, current: CustomerCall | null): boolean {
  if (!current) return true
  if (incoming.id === current.id) return current.state !== 'ended' || incoming.state === 'ended'
  return new Date(incoming.startedAt).getTime() >= new Date(current.startedAt).getTime()
}

function seconds(from: string, to: Date | string | number): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000))
}

/** The timer: ringing from the start, a call answered from the answer, an ended one its length. */
export function customerCallSeconds(call: CustomerCall, now: Date | string | number): number {
  if (call.state === 'ended') {
    if (call.durationSeconds !== null) return call.durationSeconds
    return call.endedAt ? seconds(call.startedAt, call.endedAt) : 0
  }
  return seconds(call.answeredAt ?? call.startedAt, now)
}

function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/** Everything the call screen says, in the customer's language. */
export interface CustomerCallCopy {
  section: string
  line: string
  transcriptTitle: string
  transcriptLabel: string
  empty: string
  sayLabel: string
  sayPlaceholder: string
  mutedPlaceholder: string
  send: string
  mute: string
  muted: string
  hangUp: string
  answer: string
  reject: string
  callAgain: string
  you: string
  incoming: string
  incomingHint: string
  durationLabel: string
  loadErrorTitle: string
  loadErrorBody: string
}

export function customerCallCopy(language: Language): CustomerCallCopy {
  const t = customerT(language)
  return {
    section: t('call.section'),
    line: t('call.line'),
    transcriptTitle: t('call.transcriptTitle'),
    transcriptLabel: t('call.transcriptLabel'),
    empty: t('call.empty'),
    sayLabel: t('call.sayLabel'),
    sayPlaceholder: t('call.sayPlaceholder'),
    mutedPlaceholder: t('call.mutedPlaceholder'),
    send: t('call.send'),
    mute: t('call.mute'),
    muted: t('call.muted'),
    hangUp: t('call.hangUp'),
    answer: t('call.answer'),
    reject: t('call.reject'),
    callAgain: t('call.callAgain'),
    you: t('call.you'),
    incoming: t('call.incoming'),
    incomingHint: t('call.incomingHint'),
    durationLabel: t('call.durationLabel'),
    loadErrorTitle: t('call.loadErrorTitle'),
    loadErrorBody: t('call.loadErrorBody'),
  }
}

/** The call screen's title: "Llamando…", "Te atiende Daniela", "Llamada terminada, 4 min 2 s". */
export function customerCallTitle(call: CustomerCall | null, language: Language): string {
  const t = customerT(language)
  const name = call?.agentName ?? t('someone')
  switch (customerCallPhase(call)) {
    case 'none':
      return t('call.title.none')
    case 'dialing':
      return t('call.title.dialing')
    case 'incoming':
      return t('call.incoming')
    case 'live':
      return t('call.title.live', { name })
    case 'hold':
      return t('call.title.hold', { name })
    case 'ended': {
      const ended = call as CustomerCall
      if (ended.endReason === 'rejected') return t('call.title.rejected')
      if (ended.endReason === 'cancelled' || ended.answeredAt === null) {
        return t('call.title.unanswered')
      }
      return ended.durationSeconds !== null
        ? t('call.title.endedAfter', { duration: duration(ended.durationSeconds) })
        : t('call.title.ended')
    }
  }
}

/** The line under the title (who is on the other side, what happens next). */
export function customerCallSubline(call: CustomerCall | null, language: Language): string | null {
  const t = customerT(language)
  switch (customerCallPhase(call)) {
    case 'dialing':
      return t('call.line')
    case 'hold':
      return t('call.holdHint')
    case 'ended':
      return call?.answeredAt ? t('call.endedHint') : null
    default:
      return null
  }
}

/** One line of the call as the customer sees it. */
export interface CallLineItem {
  key: string
  /** `system`: held, resumed, ended. */
  side: 'me' | 'bank' | 'system'
  /** "Tú" / "Você", the analyst's first name; null for system lines. */
  who: string | null
  /** "02:41" inside the call. */
  time: string
  text: string
}

/**
 * The lines of this call: the conversation's `transcript` turns between the call's start and
 * end (one call at a time), timed from the answer.
 */
export function customerCallLines(
  turns: readonly CustomerTurn[],
  call: CustomerCall | null,
  language: Language,
): CallLineItem[] {
  if (!call) return []
  const start = new Date(call.startedAt).getTime()
  const end = call.endedAt ? new Date(call.endedAt).getTime() : Number.POSITIVE_INFINITY
  const you = customerCallCopy(language).you
  return turns
    .filter((turn) => {
      if (turn.kind !== 'transcript') return false
      const at = new Date(turn.createdAt).getTime()
      return at >= start && at <= end
    })
    .map((turn) => ({
      key: turn.clientMessageId ?? turn.id,
      side:
        turn.authorRole === 'customer' ? 'me' : turn.authorRole === 'system' ? 'system' : 'bank',
      who:
        turn.authorRole === 'customer'
          ? you
          : turn.authorRole === 'system'
            ? null
            : (turn.authorName ?? 'LATAM Bank'),
      time: formatTimer(seconds(call.answeredAt ?? call.startedAt, turn.createdAt)),
      text: turn.text,
    }))
}

/** A failed call action or line, in the customer's language. */
export function describeCustomerCallFailure(error: unknown, language: Language): string {
  const t = customerT(language)
  // Slice 19: the assistant holds the chat; a call cannot join it (contract §1, §3.5).
  if (isApiProblem(error, 'assistant_active')) return assistantActiveMessage(language)
  if (isApiProblem(error, 'call_in_progress')) return t('call.failure.inProgress')
  if (isApiProblem(error, 'call_not_active') || isApiProblem(error, 'invalid_transition')) {
    return t('call.failure.notActive')
  }
  if (isApiProblem(error, 'network_error')) return t('networkFailure')
  return t('call.failure.generic')
}

// ── The email thread, as the customer reads it ───────────────────────────────

/** One email of the customer's thread (or a platform notice between them). */
export interface MailItem {
  key: string
  kind: 'mail' | 'notice'
  mine: boolean
  /** "Tú" / "Você", or "Daniela, LATAM Bank". */
  from: string
  subject: string | null
  body: string
  createdAt: string
  /** A reply of the bank the customer has not answered yet. */
  isNew: boolean
  /** The newest email: open; the older ones show one line. */
  latest: boolean
}

/**
 * The thread of the current conversation: its emails and notices in order. The bank's emails
 * after the customer's last one are "Nuevo".
 */
export function customerMailItems(turns: readonly CustomerTurn[], language: Language): MailItem[] {
  const you = customerCallCopy(language).you
  const relevant = turns.filter((turn) => turn.kind === 'email' || turn.kind === 'notice')
  const lastMine = relevant.findLastIndex(
    (turn) => turn.kind === 'email' && turn.authorRole === 'customer',
  )
  const lastEmail = relevant.findLastIndex((turn) => turn.kind === 'email')
  return relevant.map((turn, index) => {
    const mine = turn.authorRole === 'customer'
    return {
      key: turn.clientMessageId ?? turn.id,
      kind: turn.kind === 'email' ? 'mail' : 'notice',
      mine,
      from: mine ? you : turn.authorName ? `${turn.authorName}, LATAM Bank` : 'LATAM Bank',
      subject: turn.subject,
      body: turn.text,
      createdAt: turn.createdAt,
      isNew: turn.kind === 'email' && !mine && index > lastMine,
      latest: index === lastEmail,
    }
  })
}

/** The thread's subject (its first email's), or null before the first email. */
export function customerThreadSubject(turns: readonly CustomerTurn[]): string | null {
  return turns.find((turn) => turn.kind === 'email' && turn.subject)?.subject ?? null
}

/**
 * The customer writes a new email (with a subject) when the current conversation has no email
 * yet or it is closed (a new email opens a new case); otherwise a reply in the thread.
 */
export function mailComposeMode(
  conversation: Pick<CustomerConversation, 'status'> | null,
  subject: string | null,
): 'new' | 'reply' {
  if (!conversation || conversation.status === 'closed' || !subject) return 'new'
  return 'reply'
}

/** "Re: …" once (as the backend threads it). */
export function customerReplySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`
}

export const MAX_EMAIL_SUBJECT = 200

/** Client check of the email before sending (the server checks it again). */
export function validateCustomerEmail(
  mode: 'new' | 'reply',
  subject: string,
  body: string,
  language: Language,
): string | null {
  const t = customerT(language)
  if (mode === 'new' && (!subject.trim() || !body.trim())) {
    return t('mail.validation.subjectAndBody')
  }
  if (!body.trim()) return t('mail.validation.body')
  if (subject.trim().length > MAX_EMAIL_SUBJECT) return t('mail.validation.subjectTooLong')
  return null
}

/** The email the customer sent, as a turn of the conversation (the POST answers an email). */
export function emailAsTurn(email: CustomerEmail, language: Language): CustomerTurn {
  return {
    id: email.id,
    sequence: email.sequence,
    kind: 'email',
    authorRole: 'customer',
    authorName: email.authorName,
    text: email.body,
    subject: email.subject,
    language,
    createdAt: email.createdAt,
    clientMessageId: email.clientMessageId,
  }
}

export interface CustomerMailCopy {
  newHeading: string
  composeNew: string
  composeReply: string
  subjectLabel: string
  bodyLabel: string
  newPlaceholder: string
  replyPlaceholder: string
  empty: string
  send: string
  threadLabel: string
  replyHint: string
  newMark: string
  support: string
}

export function customerMailCopy(language: Language): CustomerMailCopy {
  const t = customerT(language)
  return {
    newHeading: t('mail.newHeading'),
    composeNew: t('mail.composeNew'),
    composeReply: t('mail.composeReply'),
    subjectLabel: t('mail.subjectLabel'),
    bodyLabel: t('mail.bodyLabel'),
    newPlaceholder: t('mail.newPlaceholder'),
    replyPlaceholder: t('mail.replyPlaceholder'),
    empty: t('mail.empty'),
    send: t('mail.send'),
    threadLabel: t('mail.threadLabel'),
    replyHint: t('mail.replyHint'),
    newMark: t('mail.newMark'),
    support: t('mail.support'),
  }
}

/** A failed email, in the customer's language. */
export function describeCustomerEmailFailure(error: unknown, language: Language): string {
  const t = customerT(language)
  // Slice 19: the assistant holds the chat; an email cannot join it (contract §1, §3.5).
  if (isApiProblem(error, 'assistant_active')) return assistantActiveMessage(language)
  if (isApiProblem(error, 'network_error')) return t('networkFailure')
  if (isApiProblem(error, 'validation_error') || isApiProblem(error, 'invalid_value')) {
    return t('mail.failure.invalid')
  }
  return t('mail.failure.generic')
}

/** The chat view shows chat messages and notices only (calls and emails have their own view). */
export function chatTurns(cache: CustomerChatCache): CustomerChatCache {
  const turns = cache.turns.filter((turn) => turn.kind === 'message' || turn.kind === 'notice')
  return turns.length === cache.turns.length ? cache : { ...cache, turns }
}
