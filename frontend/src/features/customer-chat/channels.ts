/**
 * Simulator channel rules (slice 12, docs/platform/api/slice-12-channels.md §3.2): which channel
 * the customer picked (`?channel=`), the customer's view of a call (phase, title, timer, lines)
 * and of the email thread, and their copy in the customer's language (es | pt). Pure and
 * unit-tested (channels.test.ts).
 */
import { isApiProblem } from '@/lib/api'
import { assistantActiveMessage } from './assistant'
import { formatTimer } from '@/lib/format'
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

/** The three cards of "¿Cómo se comunica {nombre} con el banco?" (simulator chrome: Spanish). */
export const CHANNEL_OPTIONS: readonly {
  value: SimChannel
  title: string
  description: string
}[] = [
  { value: 'chat', title: 'Chat', description: 'Escribe desde la app' },
  { value: 'call', title: 'Llamar', description: 'Habla con una persona' },
  { value: 'email', title: 'Escribir un correo', description: 'Te responden por correo' },
]

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
}

const CALL_COPY: Record<Language, CustomerCallCopy> = {
  es: {
    section: 'Llamada con el banco',
    line: 'Línea de atención LATAM Bank',
    transcriptTitle: 'Lo que se dice en la llamada',
    transcriptLabel: 'Transcripción de la llamada',
    empty: 'Cuando te atiendan, aquí aparece lo que dicen.',
    sayLabel: 'Lo que dices',
    sayPlaceholder: 'Escribe lo que le dices',
    mutedPlaceholder: 'Estás en silencio',
    send: 'Enviar',
    mute: 'Silenciar',
    muted: 'En silencio',
    hangUp: 'Colgar',
    answer: 'Contestar',
    reject: 'Rechazar',
    callAgain: 'Volver a llamar',
    you: 'Tú',
    incoming: 'LATAM Bank te está llamando',
    incomingHint: 'Una persona del equipo quiere hablar contigo sobre tu caso.',
    durationLabel: 'Duración',
  },
  pt: {
    section: 'Ligação com o banco',
    line: 'Central de atendimento LATAM Bank',
    transcriptTitle: 'O que se fala na ligação',
    transcriptLabel: 'Transcrição da ligação',
    empty: 'Quando te atenderem, aqui aparece o que é dito.',
    sayLabel: 'O que você diz',
    sayPlaceholder: 'Escreva o que você diz',
    mutedPlaceholder: 'Você está no mudo',
    send: 'Enviar',
    mute: 'Silenciar',
    muted: 'No mudo',
    hangUp: 'Desligar',
    answer: 'Atender',
    reject: 'Recusar',
    callAgain: 'Ligar de novo',
    you: 'Você',
    incoming: 'O LATAM Bank está te ligando',
    incomingHint: 'Uma pessoa da equipe quer falar com você sobre o seu caso.',
    durationLabel: 'Duração',
  },
}

export function customerCallCopy(language: Language): CustomerCallCopy {
  return CALL_COPY[language] ?? CALL_COPY.es
}

/** The call screen's title: "Llamando…", "Te atiende Daniela", "Llamada terminada, 4 min 2 s". */
export function customerCallTitle(call: CustomerCall | null, language: Language): string {
  const pt = language === 'pt'
  const agent = call?.agentName ?? (pt ? 'uma pessoa da equipe' : 'una persona del equipo')
  switch (customerCallPhase(call)) {
    case 'none':
      return pt ? 'Ligue para o banco' : 'Llama al banco'
    case 'dialing':
      return pt ? 'Ligando…' : 'Llamando…'
    case 'incoming':
      return CALL_COPY[pt ? 'pt' : 'es'].incoming
    case 'live':
      return pt ? `Você está falando com ${agent}` : `Te atiende ${agent}`
    case 'hold':
      return pt ? `${agent} colocou você em espera` : `${agent} te puso en espera`
    case 'ended': {
      const ended = call as CustomerCall
      if (ended.endReason === 'rejected')
        return pt ? 'Você recusou a ligação' : 'Rechazaste la llamada'
      if (ended.endReason === 'cancelled' || ended.answeredAt === null) {
        return pt ? 'Ligação encerrada sem resposta' : 'Llamada terminada sin respuesta'
      }
      const length = ended.durationSeconds !== null ? `, ${duration(ended.durationSeconds)}` : ''
      return pt ? `Ligação encerrada${length}` : `Llamada terminada${length}`
    }
  }
}

/** The line under the title (who is on the other side, what happens next). */
export function customerCallSubline(call: CustomerCall | null, language: Language): string | null {
  const pt = language === 'pt'
  switch (customerCallPhase(call)) {
    case 'dialing':
      return CALL_COPY[pt ? 'pt' : 'es'].line
    case 'hold':
      return pt ? 'Aguarde na linha, já voltam.' : 'Espera en línea, ya vuelven contigo.'
    case 'ended':
      return call?.answeredAt
        ? pt
          ? 'Seu caso continua aberto. Se precisar de algo mais, ligue de novo.'
          : 'Tu caso sigue abierto. Si necesitas algo más, vuelve a llamar.'
        : null
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
  const pt = language === 'pt'
  // Slice 19: the assistant holds the chat; a call cannot join it (contract §1, §3.5).
  if (isApiProblem(error, 'assistant_active')) return assistantActiveMessage(language)
  if (isApiProblem(error, 'call_in_progress')) {
    return pt ? 'Você já tem uma ligação em andamento.' : 'Ya tienes una llamada en curso.'
  }
  if (isApiProblem(error, 'call_not_active') || isApiProblem(error, 'invalid_transition')) {
    return pt ? 'A ligação já não está ativa.' : 'La llamada ya no está activa.'
  }
  if (isApiProblem(error, 'network_error')) {
    return pt ? 'Sem conexão. Tente de novo.' : 'No hay conexión. Inténtalo de nuevo.'
  }
  return pt ? 'Não foi possível. Tente de novo.' : 'No se pudo. Inténtalo de nuevo.'
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
  const pt = language === 'pt'
  if (mode === 'new' && (!subject.trim() || !body.trim())) {
    return pt ? 'Escreva o assunto e a mensagem.' : 'Escribe el asunto y el mensaje.'
  }
  if (!body.trim()) return pt ? 'Escreva sua resposta.' : 'Escribe tu respuesta.'
  if (subject.trim().length > MAX_EMAIL_SUBJECT) {
    return pt ? 'O assunto é muito longo.' : 'El asunto es muy largo.'
  }
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

const MAIL_COPY: Record<Language, CustomerMailCopy> = {
  es: {
    newHeading: 'Nuevo correo',
    composeNew: 'Escribe tu correo',
    composeReply: 'Responder',
    subjectLabel: 'Asunto',
    bodyLabel: 'Mensaje',
    newPlaceholder: 'Cuéntanos qué pasó',
    replyPlaceholder: 'Escribe tu respuesta',
    empty: 'Escribe tu consulta. Te responde una persona del equipo en este mismo hilo.',
    send: 'Enviar',
    threadLabel: 'Correos del hilo',
    replyHint: 'Te responden en este hilo',
    newMark: 'Nuevo',
    support: 'Soporte LATAM Bank',
  },
  pt: {
    newHeading: 'Novo e-mail',
    composeNew: 'Escreva seu e-mail',
    composeReply: 'Responder',
    subjectLabel: 'Assunto',
    bodyLabel: 'Mensagem',
    newPlaceholder: 'Conte o que aconteceu',
    replyPlaceholder: 'Escreva sua resposta',
    empty: 'Escreva sua dúvida. Uma pessoa da equipe responde neste mesmo e-mail.',
    send: 'Enviar',
    threadLabel: 'E-mails da conversa',
    replyHint: 'A resposta chega aqui',
    newMark: 'Novo',
    support: 'Suporte LATAM Bank',
  },
}

export function customerMailCopy(language: Language): CustomerMailCopy {
  return MAIL_COPY[language] ?? MAIL_COPY.es
}

/** A failed email, in the customer's language. */
export function describeCustomerEmailFailure(error: unknown, language: Language): string {
  const pt = language === 'pt'
  // Slice 19: the assistant holds the chat; an email cannot join it (contract §1, §3.5).
  if (isApiProblem(error, 'assistant_active')) return assistantActiveMessage(language)
  if (isApiProblem(error, 'network_error')) {
    return pt ? 'Sem conexão. Tente de novo.' : 'No hay conexión. Inténtalo de nuevo.'
  }
  if (isApiProblem(error, 'validation_error') || isApiProblem(error, 'invalid_value')) {
    return pt ? 'Revise o assunto e a mensagem.' : 'Revisa el asunto y el mensaje.'
  }
  return pt ? 'Não foi possível enviar. Tente de novo.' : 'No se envió. Inténtalo de nuevo.'
}

/** The chat view shows chat messages and notices only (calls and emails have their own view). */
export function chatTurns(cache: CustomerChatCache): CustomerChatCache {
  const turns = cache.turns.filter((turn) => turn.kind === 'message' || turn.kind === 'notice')
  return turns.length === cache.turns.length ? cache : { ...cache, turns }
}
