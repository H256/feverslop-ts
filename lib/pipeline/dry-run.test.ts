import {expect, test} from 'bun:test'
import type {DryRun} from '../../shared/workspace.ts'
import {defaults} from '../config.ts'
import type {RenderState} from '../render-state.ts'
import {sayRenders} from './dry-run.ts'

const clip = (id: string) => ({id, frames: 97})
// the state holds the same clip objects in each list, as renderStateOf makes it
const state = (): RenderState<{id: string; frames: number}> => {
    const clips = [clip('clip-001'), clip('clip-002'), clip('clip-003')]
    return {
        pictures: [],
        missingPictures: [],
        stalePictures: [],
        clips,
        missingClips: [clips[1]!],
        staleClips: [],
        finalVideo: 'film.mp4',
        finalState: 'missing',
    }
}
const empty = (): DryRun => ({reasons: [], redone: [], plannedAgain: [], staleAfter: [], generated: [], warnings: []})

// #1151: the music video and the film say what --render would render with one function - the clips missing, the ones of
// --again, the stale ones with --refresh=clips; the final video needs every clip
test('a dry run counts the clips --render would render and what the final video still needs', async () => {
    const s = state()
    s.staleClips = [s.clips[2]!]
    const how = {config: defaults, servers: [], finalLabel: 'Film', changes: true}
    const found = empty()
    await sayRenders(found, s, {render: new Set(['videos', 'final']), refresh: new Set(), only: new Set(), again: false}, how)
    expect(found.clips?.ids).toEqual(['clip-002'])
    expect(found.final).toEqual({missingClips: 1})
    expect(found.warnings[0]).toContain('counted from the requests of the last plan run')

    const refreshed = empty()
    await sayRenders(refreshed, s, {render: new Set(['videos']), refresh: new Set(['clips']), only: new Set(), again: false}, {...how, changes: false})
    expect(refreshed.clips?.ids).toEqual(['clip-002', 'clip-003'])
    expect(refreshed.warnings).toEqual([])

    const again = empty()
    await sayRenders(again, s, {render: new Set(['videos']), refresh: new Set(), only: new Set(['clip-001']), again: true}, how)
    expect(again.clips?.ids).toEqual(['clip-001'])
})
