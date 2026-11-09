import {expect, test} from 'bun:test'
import type * as wire from '../../shared/workspace.ts'
import type {AssetKind} from '../asset-import.ts'
import type {Freshness} from '../provenance.ts'
import type {FinalState} from '../render-state.ts'
import type {RunState} from '../run-record.ts'
import {PLAN_STAGES, type PlanStage} from '../stages.ts'

// shared/workspace.ts is browser-safe and imports nothing from the pipeline, so the words both sides use are written twice. They
// must stay the same: a difference is a type error here, in bun run typecheck, before it is a page that reads a word it does not know.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const same: [
    Same<wire.PlanStage, PlanStage>,
    Same<wire.Freshness, Freshness>,
    Same<wire.FinalState, FinalState>,
    Same<wire.RunState, RunState>,
    Same<wire.AssetKind, AssetKind>,
] = [true, true, true, true, true]

test('the words the page and the pipeline share are the same on both sides', () => {
    expect(same.every(Boolean)).toBe(true)
    const stages: wire.PlanStage[] = ['story', 'cast', 'look', 'plan']
    expect([...PLAN_STAGES].sort()).toEqual(stages.sort())
})
