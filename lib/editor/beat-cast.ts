// People brought into chosen beats of a planned music video (#765): characters of the cast, and new ones who join it, go into
// the beats' characterIds; the floor plan (blocking) and the shots of those beats go, so the next plan run plans just them again
// (index.ts "Planning again", as --beats of #762). The director's words for them are kept as a direction rule on each beat - the
// planner gets them (directionPlanNotes). The story, the timeline and every other beat stay. CLI: bun run direction --with.
import {randomUUID} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {writeJsonFile} from '../json-file.ts'
import {CASTING_FILE, castingAfterCastChange, readCastingFile} from '../casting.ts'
import {withProjectLock} from '../lock.ts'
import {dropBeatPlans, type Project} from '../project.ts'
import {readDirection, setDirectionRules} from '../direction/service.ts'
import {applyCastJoin} from './preproduction.ts'
import type {EditorTarget} from './project.ts'
import type {BeatCastChange, BeatCastResult} from '../../shared/workspace.ts'

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined)
const BEAT_ID = /^[a-z0-9][a-z0-9-]*$/

/** The change put into the project data, in place - nothing is asked of the language model, nothing is rendered. */
export function applyBeatCast(data: Project, change: BeatCastChange): BeatCastResult {
    if (!data.cast || !data.beats) throw new Error('no beats yet - plan the project first')
    const beatIds = [...new Set(change?.beats ?? [])]
    if (!beatIds.length || beatIds.some(b => typeof b !== 'string' || !BEAT_ID.test(b))) throw new Error('name the beats to bring people into')
    const unknownBeats = beatIds.filter(id => !data.beats!.some(b => b.id === id))
    if (unknownBeats.length) throw new Error(`no beat ${unknownBeats.join(', ')} - the beats are ${data.beats.map(b => b.id).join(', ')}`)
    const wanted = [...new Set(change.characters ?? [])]
    const unknown = wanted.filter(id => !data.cast!.characters.some(c => c.id === id))
    if (unknown.length) throw new Error(`no character ${unknown.join(', ')} in the cast - a new one joins it with a name and a role`)
    const join = (change.join ?? []).map((j, n) => {
        const name = typeof j?.name === 'string' ? j.name.replace(/\s+/g, ' ').trim() : ''
        const role = typeof j?.role === 'string' ? j.role.replace(/\s+/g, ' ').trim() : ''
        if (!name || !role) throw new Error(`the new person ${n + 1} needs a name and a role (who they are, what they look like)`)
        return {name, role}
    })
    if (!wanted.length && !join.length) throw new Error('name who comes into the beats: a character of the cast or a new one')
    const {joined, remade} = applyCastJoin(data, join)
    const bringing = [...wanted, ...joined]
    const added: BeatCastResult['added'] = []
    for (const beatId of beatIds) {
        const beat = data.beats.find(b => b.id === beatId)!
        for (const character of bringing.filter(id => !beat.characterIds.includes(id))) {
            beat.characterIds.push(character)
            added.push({beat: beatId, character})
        }
        // where everybody stands was planned without them: the beat plans its floor plan with its shots (index.ts 11b)
        delete data.blocking?.[beatId]
    }
    const replanned = dropBeatPlans(data, beatIds)
    return {joined, remade, added, replanned, beats: beatIds}
}

/**
 * The change written: project.json (and casting.json for whoever joined), then the note as a direction rule on each beat - saved
 * for a beat without shots now, it holds for the shots the next plan run gives it.
 */
export async function writeBeatCast(target: EditorTarget, change: BeatCastChange): Promise<BeatCastResult> {
    if (target.kind !== 'music') throw new Error('people are brought into beats of a music video; a film has its script')
    const note = typeof change?.note === 'string' ? change.note.replace(/\s+/g, ' ').trim() : ''
    if (note.length > 2000) throw new Error('the note is longer than 2000 characters')
    const result = await withProjectLock(target.dir, target.id, () => {
        const file = join(target.dir, 'project.json')
        const data = readJson<Project>(file)
        if (!data) throw new Error('no project.json yet - plan the project first')
        const before = structuredClone(data.cast)
        const result = applyBeatCast(data, change)
        writeJsonFile(file, data)
        // casting.json follows who is in the cast: whoever joined runs as "project:" (bun run cast does the same)
        if (result.joined.length && before && data.cast && existsSync(join(target.dir, CASTING_FILE))) {
            const casting = castingAfterCastChange(readCastingFile(target.dir), before, data.cast)
            if (casting) writeJsonFile(join(target.dir, CASTING_FILE), casting)
        }
        return result
    })
    if (note) {
        const rules = readDirection(target).rules
        // for the planner, which plans these beats now: nothing to preview or take
        const added = result.beats.map(beat => ({id: randomUUID(), text: note, scope: {kind: 'beat' as const, id: beat}, planned: true}))
        await setDirectionRules(target, {rules: [...rules, ...added]})
        result.rules = added.length
    }
    return result
}
