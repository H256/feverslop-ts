import type {TimingChange} from './workspace.ts'

export type RefinementLanguage = 'de' | 'en' | 'fr'
export type TimingRefinement = {
    id: string
    fingerprint: string
    language: RefinementLanguage
    model: string
    change: TimingChange
    entries: {
        line: number
        text: string
        status: 'refined' | 'omit' | 'protected' | 'review'
        reason: string
        before: [number, number]
        after?: [number, number]
    }[]
}
