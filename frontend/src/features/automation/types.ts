/** API types of "Automatización" (slice 22): the stages (slice 21) and the builder (slice 16). */
import type { Schemas } from '@/lib/api'

export type AiStages = Schemas['AiStages']
export type CaseTypeStage = Schemas['CaseTypeStage']
export type StageRule = Schemas['StageRule']
export type CaseType = Schemas['CaseType']
/** Every case type but "Sin tipo" (it does not mature). */
export type MaturingType = Exclude<CaseType, 'none'>
export type MoveStageBackResult = Schemas['MoveStageBackResult']
export type ActivateAgentResult = Schemas['ActivateAgentResult']

export type BuilderStatus = Schemas['BuilderStatus']
export type Proposal = Schemas['Proposal']
export type ProposalState = Schemas['ProposalState']
export type ProposalSummary = Schemas['ProposalSummary']
export type ProposalList = Schemas['ProposalList']
export type ProposalDetail = Schemas['ProposalDetail']
export type EntityDraft = Schemas['EntityDraft']
export type ValidationReport = Schemas['ValidationReport']
export type Violation = Schemas['Violation']
export type CandidateView = Schemas['CandidateView']
export type EvalReport = Schemas['EvalReport']
export type GateItem = Schemas['GateItem']
export type YardstickChange = Schemas['YardstickChange']
export type ReleaseDetail = Schemas['ReleaseDetail']
export type AliasState = Schemas['AliasState']
export type VersionList = Schemas['VersionList']
export type VersionSummary = Schemas['VersionSummary']
export type LastDecision = Schemas['LastDecision']
/** agent-core's closed list of rejection reasons (its PR 53). */
export type ReasonCode = NonNullable<Schemas['RejectRequest']['reasonCode']>
export type ProposalRecord = Schemas['ProposalRecord']
export type ProposalImprovement = Schemas['ProposalImprovement']
export type EvidenceCase = Schemas['EvidenceCase']
export type ProposalHistoryEntry = Schemas['ProposalHistoryEntry']
export type BuilderThread = Schemas['BuilderThread']
export type BuilderMessage = Schemas['BuilderMessage']
export type BuilderExchange = Schemas['BuilderExchange']
