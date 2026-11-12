import {expect, test} from 'bun:test'
import {STAGE_STEPS} from '../client/src/features/plan/stages.ts'
import {FILM_STEP_NAMES} from './film/store.ts'
import {STEP_NAMES} from './project.ts'

// #833: the workspace marks a planned stage as changed since by its steps - every step of the plan is in one stage; the
// song's steps before the story and a film's subtitles (made at the assembly) are in none
test('every step of the plan belongs to one stage of the workspace', () => {
    const song = ['songStyle', 'music', 'stems', 'instrumentStems', 'transcript', 'lyricsTiming']
    expect(STEP_NAMES.filter(s => !song.includes(s)).toSorted() as string[]).toEqual(Object.values(STAGE_STEPS.music).flat().toSorted())
    expect(FILM_STEP_NAMES.filter(s => s !== 'subtitles').toSorted() as string[]).toEqual(Object.values(STAGE_STEPS.film).flat().toSorted())
})
