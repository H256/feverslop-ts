import type {TimingChange} from './workspace.ts'

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
        status: 'refined' | 'omit' | 'protected' | 'review'
        reason: string
        before: [number, number]
        after?: [number, number]
    }[]
}
