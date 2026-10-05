import { CalendarDays, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { supervisionCasePath } from '@/app/paths'
import { Card, Fact, LanguageMarks, Status } from '@/components/ui'
import { caseLifecycleStatus, caseType, channelFact } from '@/features/cases/core'
import { formatDate } from '@/lib/format'
import { useActiveLocale, useTranslation } from '@/lib/i18n'
import type { EvidenceCase, ProposalImprovement } from '../types'

export interface ImprovementDossierProps {
  improvement: ProposalImprovement
}

/** The language a person reads the UI in, as the dossier's language code. */
const LOCALE_LANGUAGE = { es: 'es', 'pt-BR': 'pt' } as const

/**
 * The improvement engine's dossier on the proposal page (ADR 0007): its title, then the problem,
 * the evidence and the expected effect as plain text (line breaks kept, nothing interpreted), and
 * each evidence case as a link to the supervisor's read-only case view. A case the platform no
 * longer has stays listed, without a link. The engine writes in Spanish: a person reading in
 * Portuguese is told so (the announce carries no Portuguese variant).
 */
export function ImprovementDossier({ improvement }: ImprovementDossierProps) {
  const { t } = useTranslation('automation')
  const locale = useActiveLocale()
  const foreign = LOCALE_LANGUAGE[locale] !== improvement.language
  return (
    <Card
      as="section"
      padding="md"
      aria-labelledby="proposal-dossier"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <h2
          id="proposal-dossier"
          className="m-0 inline-flex items-center gap-1.5 text-13 font-semibold text-accent-strong"
        >
          <Sparkles size={14} aria-hidden="true" />
          {t('dossier.title')}
        </h2>
        <p lang={improvement.language} className="m-0 text-17 font-semibold break-words">
          {improvement.title}
        </p>
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-12 text-ink-2">
          <li className="inline-flex items-center gap-1">
            <CalendarDays size={13} aria-hidden="true" />
            {t('dossier.announced', { date: formatDate(improvement.announcedAt) })}
          </li>
          {foreign ? (
            <li className="inline-flex items-center gap-1.5">
              <LanguageMarks languages={[improvement.language]} />
              {t('dossier.writtenIn')}
            </li>
          ) : null}
        </ul>
      </div>
      <dl className="m-0 flex flex-col gap-3">
        <DossierText label={t('dossier.problem')} lang={improvement.language}>
          {improvement.problem}
        </DossierText>
        <DossierText label={t('dossier.evidence')} lang={improvement.language}>
          {improvement.evidence}
        </DossierText>
        <DossierText label={t('dossier.expectedEffect')} lang={improvement.language}>
          {improvement.expectedEffect}
        </DossierText>
      </dl>
      <EvidenceCases cases={improvement.evidenceCases} />
    </Card>
  )
}

function DossierText({ label, lang, children }: { label: string; lang: string; children: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-12 font-semibold tracking-label text-muted uppercase">{label}</dt>
      <dd lang={lang} className="m-0 text-14 break-words whitespace-pre-line">
        {children}
      </dd>
    </div>
  )
}

function EvidenceCases({ cases }: { cases: EvidenceCase[] }) {
  const { t } = useTranslation('automation')
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-13 font-semibold">{t('dossier.cases')}</h3>
      {cases.length === 0 ? (
        <p className="m-0 text-13 text-ink-2">{t('dossier.casesEmpty')}</p>
      ) : (
        <ul
          aria-label={t('dossier.casesTable')}
          className="m-0 flex list-none flex-col divide-y divide-border-soft rounded-12 border border-border p-0"
        >
          {cases.map((evidence) => (
            <li
              key={evidence.caseId}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
            >
              <EvidenceRow evidence={evidence} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The channel as an icon-only fact (its key stays out of the spread props). */
function ChannelFact({ channel }: { channel: NonNullable<EvidenceCase['channel']> }) {
  const { key: _key, ...fact } = channelFact(channel)
  return <Fact {...fact} />
}

function EvidenceRow({ evidence }: { evidence: EvidenceCase }) {
  const { t } = useTranslation('automation')
  if (!evidence.available) {
    return (
      <>
        <span className="font-mono text-13 text-muted">{evidence.caseId}</span>
        <Fact icon="alert" text={t('dossier.caseGone')} tone="muted" />
      </>
    )
  }
  return (
    <>
      <Link
        to={supervisionCasePath(evidence.caseId)}
        aria-label={t('dossier.openCase', { id: evidence.caseId })}
        className="font-mono text-13 text-link"
      >
        {evidence.caseId}
      </Link>
      {evidence.status ? <Status {...caseLifecycleStatus(evidence.status)} size="sm" /> : null}
      {evidence.caseType ? (
        <span className="text-13 text-ink-2">{caseType(evidence.caseType).label}</span>
      ) : null}
      {evidence.channel ? <ChannelFact channel={evidence.channel} /> : null}
      {evidence.language ? <LanguageMarks languages={[evidence.language]} /> : null}
    </>
  )
}
