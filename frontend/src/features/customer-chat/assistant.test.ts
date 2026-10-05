import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { makeCustomerConversation } from '@/test/conversation-fixtures'
import {
  assistantActiveMessage,
  assistantCopy,
  assistantView,
  confirmationAlreadySaid,
  confirmationExpiry,
  describeAssistantFailure,
  hadAssistant,
  isAssistantActive,
  isAssistantName,
  isConfirmationExpired,
  normalizeStepUpCode,
  wrongCodeMessage,
} from './assistant'

const confirmation = {
  summary: 'Radicar una disputa por 120 USD',
  token: 'tok-1',
  expiresAt: '2099-01-01T16:05:00Z',
}

describe('assistantView', () => {
  it('shows nothing unless the assistant holds the conversation', () => {
    expect(assistantView(null).canAskPerson).toBe(false)
    expect(assistantView(makeCustomerConversation({ status: 'with_agent' }))).toEqual({
      working: false,
      confirmation: null,
      stepUp: null,
      canAskPerson: false,
    })
  })

  it('offers a person always, and the one card the assistant waits for', () => {
    const working = makeCustomerConversation({
      status: 'with_assistant',
      assistant: { working: true, confirmation: null, stepUp: null },
    })
    expect(assistantView(working)).toMatchObject({ working: true, canAskPerson: true })
    const both = makeCustomerConversation({
      status: 'with_assistant',
      assistant: {
        working: false,
        confirmation,
        stepUp: { reason: 'requires_step_up', simulated: true },
      },
    })
    expect(assistantView(both)).toMatchObject({ confirmation, stepUp: null })
    const stepUp = makeCustomerConversation({
      status: 'with_assistant',
      assistant: { working: false, confirmation: null, stepUp: { reason: 'x', simulated: true } },
    })
    expect(assistantView(stepUp).stepUp).toEqual({ reason: 'x', simulated: true })
    // A missing state still keeps the way out.
    expect(
      assistantView(makeCustomerConversation({ status: 'with_assistant', assistant: null })),
    ).toMatchObject({ working: false, canAskPerson: true })
  })
})

describe('names and history', () => {
  it('recognises the assistant by the names the server gives it', () => {
    expect(isAssistantName('Asistente virtual')).toBe(true)
    expect(isAssistantName('Assistente virtual')).toBe(true)
    expect(isAssistantName('Daniela')).toBe(false)
    expect(isAssistantName(null)).toBe(false)
  })

  it('knows whether the assistant spoke in the conversation', () => {
    expect(hadAssistant([{ authorRole: 'customer' }, { authorRole: 'assistant' }])).toBe(true)
    expect(hadAssistant([{ authorRole: 'customer' }])).toBe(false)
  })
})

describe('confirmation and second factor', () => {
  it('says when the confirmation expires, in the customer language', () => {
    expect(confirmationExpiry(confirmation, 'es')).toBe('Vence a las 11:05')
    expect(confirmationExpiry(confirmation, 'pt')).toBe('Vence às 11:05')
    expect(isConfirmationExpired(confirmation, Date.parse('2099-01-01T16:04:59Z'))).toBe(false)
    expect(isConfirmationExpired(confirmation, Date.parse('2099-01-01T16:05:00Z'))).toBe(true)
  })

  it('knows when the last assistant message already asks the confirmation, es and pt', () => {
    const said = (role: 'assistant' | 'customer', text: string) => ({ authorRole: role, text })
    const es = 'Voy a radicar la disputa del cargo. ¿Confirmas?'
    expect(confirmationAlreadySaid(es, [said('customer', 'x'), said('assistant', es)])).toBe(true)
    // Spacing and case apart, or inside a longer message.
    expect(
      confirmationAlreadySaid(es, [
        said('assistant', 'Listo, Natalia.  voy a radicar la disputa del cargo.\n¿confirmas?'),
      ]),
    ).toBe(true)
    const pt = 'Vou registrar a contestação. Confirma?'
    expect(confirmationAlreadySaid(pt, [said('assistant', pt)])).toBe(true)
    // Only the last assistant message counts; a different one keeps the summary on the card.
    expect(
      confirmationAlreadySaid(pt, [said('assistant', pt), said('assistant', 'Qual cobrança?')]),
    ).toBe(false)
    expect(
      confirmationAlreadySaid('Radicar una disputa por 120 USD', [said('assistant', es)]),
    ).toBe(false)
    expect(confirmationAlreadySaid(es, [said('customer', es)])).toBe(false)
    expect(confirmationAlreadySaid('  ', [said('assistant', es)])).toBe(false)
  })

  it('keeps six digits of the code', () => {
    expect(normalizeStepUpCode(' 12-34 567 ')).toBe('123456')
  })

  it('counts the attempts left', () => {
    expect(wrongCodeMessage(2, 'es')).toBe('Código incorrecto. Te quedan 2 intentos.')
    expect(wrongCodeMessage(1, 'es')).toBe('Código incorrecto. Te queda 1 intento.')
    expect(wrongCodeMessage(2, 'pt')).toBe('Código incorreto. Restam 2 tentativas.')
    expect(wrongCodeMessage(1, 'pt')).toBe('Código incorreto. Resta 1 tentativa.')
  })

  it('labels the simulated code', () => {
    expect(assistantCopy('es').simulated).toBe('Código simulado de desarrollo: 000000')
    expect(assistantCopy('pt').simulated).toBe('Código simulado de desenvolvimento: 000000')
  })
})

describe('describeAssistantFailure', () => {
  const problem = (status: number, code: string, extensions?: Record<string, unknown>) =>
    new ApiProblem({ status, code: code as ApiProblem['code'], extensions })

  it('reports a wrong code with its attempts, and the third one as a hand-over', () => {
    expect(
      describeAssistantFailure(
        problem(422, 'invalid_step_up_code', { remainingAttempts: 2 }),
        'step_up',
        'es',
      ),
    ).toEqual({
      message: 'Código incorrecto. Te quedan 2 intentos.',
      refetch: false,
      remainingAttempts: 2,
    })
    expect(
      describeAssistantFailure(
        problem(422, 'invalid_step_up_code', { remainingAttempts: 0 }),
        'step_up',
        'es',
      ),
    ).toMatchObject({ refetch: true, remainingAttempts: 0 })
  })

  it('refetches when the conversation moved on', () => {
    for (const code of [
      'assistant_not_active',
      'assistant_busy',
      'confirmation_expired',
      'confirmation_not_pending',
      'step_up_not_pending',
      'assistant_disabled',
    ]) {
      expect(describeAssistantFailure(problem(409, code), 'confirm', 'es').refetch).toBe(true)
    }
    expect(
      describeAssistantFailure(problem(409, 'confirmation_expired'), 'confirm', 'es').message,
    ).toBe('La confirmación venció. Escribe de nuevo lo que necesitas.')
    expect(
      describeAssistantFailure(problem(409, 'assistant_not_active'), 'person', 'pt').message,
    ).toBe('Uma pessoa da equipe já está com a sua conversa.')
  })

  it('keeps the prompt on a network failure or anything else', () => {
    expect(describeAssistantFailure(ApiProblem.network(), 'person', 'es')).toEqual({
      message: 'No hay conexión. Inténtalo de nuevo.',
      refetch: false,
      remainingAttempts: null,
    })
    expect(describeAssistantFailure(problem(500, 'http_error'), 'person', 'es').message).toBe(
      'No pudimos pasarte con una persona. Inténtalo de nuevo.',
    )
  })

  it('explains a call or an email the assistant cannot take', () => {
    expect(isAssistantActive(problem(409, 'assistant_active'))).toBe(true)
    expect(isAssistantActive(problem(409, 'call_in_progress'))).toBe(false)
    expect(assistantActiveMessage('es')).toBe(
      'El asistente virtual te está atendiendo por chat. Escríbele por ahí o pide hablar con una persona.',
    )
  })
})
