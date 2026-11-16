import type {TimingChange, TimingResult} from './workspace.ts'

export type RefinementLanguage = 'de' | 'en' | 'fr'
export type ConfirmedPassage = {line: number; confirmSung: true; mode?: 'line-window'}
export type TimingRefinement = {
    id: string
    fingerprint: string
    language: RefinementLanguage
    model: string
    change: TimingChange
    passage?: {line: number; start: number; end: number; targets: number[]; mode?: 'line-window'}
    logFile?: string
    entries: {
        line: number
        text: string
        status: 'refined' | 'omit' | 'protected' | 'review' | 'applied'
        reason: string
        before: [number, number]
        after?: [number, number]
    }[]
}

/** The result of taking a proposal. Taking only some of its lines leaves the rest of the proposal valid: it comes back here. */
export type AppliedRefinement = TimingResult & {refinement?: TimingRefinement}
