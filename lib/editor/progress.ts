export type {ClipProgress, RunProgress, Explained} from '../../shared/workspace.ts'

// How far a run has come is told by its job events now (lib/run-events.ts, #829) - the run dock counts them; no file is polled.

// what a failure means and what to do: lib/failure-help.ts - the terminal says the same
export {explainFailure} from '../failure-help.ts'
