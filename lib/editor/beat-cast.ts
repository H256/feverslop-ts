// Who is in which beats or shots of a planned music video (#765, #767): characters of the cast, and new ones who join it, come
// into the beats' characterIds; characters go out of them. The floor plan (blocking) and the shots of the touched beats go, so the
// next plan run plans just them again (index.ts "Planning again", as --beats of #762). Beats do not line up with the song, so the
// change can be about some clips of a beat only: the beat gets the people, and each of its shots a rule saying who is in it.
// Every change leaves such presence rules - also without a note, or the planner keeps to the beat's text and leaves a newcomer
// out - and the director's words as a rule on the same beats or shots; the planner gets both (directionPlanNotes). The story,
// the timeline and every other beat stay. CLI: bun run direction --with / --out / --join.
import {randomUUID} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {writeJsonFile} from '../json-file.ts'
import {CASTING_FILE, castingAfterCastChange, readCastingFile} from '../casting.ts'
import {loadProjectConfig, type ProjectConfig} from '../config.ts'
import {withProjectLock} from '../lock.ts'
import {dropBeatPlans, type Project} from '../project.ts'
import {readDirection, setDirectionRules} from '../direction/service.ts'
import {beatClips} from '../direction/music.ts'
import {applyCastJoin} from './preproduction.ts'
import type {EditorTarget} from './project.ts'
import type {BeatCastChange, BeatCastResult} from '../../shared/workspace.ts'
import type {DirectionRule} from '../../shared/direction.ts'

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined)
const ID = /^[a-z0-9][a-z0-9-]*$/

/** A rule for the planner on a beat or a shot; `presence` says who is or is not there (the text says it in words). */
export type CastRule = Omit<DirectionRule, 'id'>
export type BeatCastApplied = BeatCastResult & {castRules: CastRule[]}

const names = (data: Project, ids: string[]) => {
    const all = ids.map(id => data.cast?.characters.find(c => c.id === id)?.name ?? id)
    return all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : all[0]!
}
const isAre = (ids: string[]) => (ids.length > 1 ? 'are' : 'is')

/**
 * The change put into the project data, in place - nothing is asked of the language model, nothing is rendered. Returns the rules
 * for direction.json with it; `clipsOfBeat` gives the clips of each beat in order, with their shot numbers (beatClips).
 */
export function applyBeatCast(data: Project, change: BeatCastChange, clipsOfBeat: Map<string, {clip: string; shots: number[]}[]>): BeatCastApplied {
    if (!data.cast || !data.beats) throw new Error('no beats yet - plan the project first')
    const clips = [...new Set(change?.clips ?? [])]
    if (clips.some(c => typeof c !== 'string' || !ID.test(c))) throw new Error('clip ids are like slot-024')
    const beatOfClip = new Map([...clipsOfBeat].flatMap(([beat, own]) => own.map(c => [c.clip, beat] as const)))
    const unknownClips = clips.filter(c => !beatOfClip.has(c))
    if (unknownClips.length) throw new Error(`no clip ${unknownClips.join(', ')} in the timeline`)
    const beatIds = [...new Set([...(change?.beats ?? []), ...clips.map(c => beatOfClip.get(c)!)])]
    if (!beatIds.length || beatIds.some(b => typeof b !== 'string' || !ID.test(b))) throw new Error('name the beats or the clips the change is about')
    const unknownBeats = beatIds.filter(id => !data.beats!.some(b => b.id === id))
    if (unknownBeats.length) throw new Error(`no beat ${unknownBeats.join(', ')} - the beats are ${data.beats.map(b => b.id).join(', ')}`)
    const inCast = (id: string) => data.cast!.characters.some(c => c.id === id)
    const wanted = [...new Set(change.characters ?? [])]
    const without = [...new Set(change.without ?? [])]
    const unknown = [...wanted, ...without].filter(id => !inCast(id))
    if (unknown.length) throw new Error(`no character ${unknown.join(', ')} in the cast - a new one joins it with a name and a role`)
    const both = wanted.filter(id => without.includes(id))
    if (both.length) throw new Error(`${both.join(', ')} cannot come in and go out at once`)
    const join = (change.join ?? []).map((j, n) => {
        const name = typeof j?.name === 'string' ? j.name.replace(/\s+/g, ' ').trim() : ''
        const role = typeof j?.role === 'string' ? j.role.replace(/\s+/g, ' ').trim() : ''
        if (!name || !role) throw new Error(`the new person ${n + 1} needs a name and a role (who they are, what they look like)`)
        return {name, role}
    })
    if (!wanted.length && !join.length && !without.length) throw new Error('name who comes into the shots or goes out of them')
    const notThere = without.filter(id => !beatIds.some(b => data.beats!.find(x => x.id === b)!.characterIds.includes(id)))
    if (notThere.length) throw new Error(`${notThere.join(', ')} ${isAre(notThere)} in none of ${beatIds.join(', ')}`)
    const note = typeof change.note === 'string' ? change.note.replace(/\s+/g, ' ').trim() : ''
    const {joined, remade} = applyCastJoin(data, join)
    const bringing = [...wanted, ...joined]
    const added: BeatCastResult['added'] = []
    const removed: NonNullable<BeatCastResult['removed']> = []
    const rules: CastRule[] = []
    const shotsAbout: string[] = []
    const rule = (scope: CastRule['scope'], text: string, presence?: CastRule['presence']) =>
        rules.push({text, scope, planned: true, ...(presence ? {presence} : {})})
    for (const beatId of beatIds) {
        const beat = data.beats.find(b => b.id === beatId)!
        const own = clipsOfBeat.get(beatId) ?? []
        // the shots the change is about: those of the marked clips, or all - then it is about the beat as a whole
        const all = !clips.length || (change.beats ?? []).includes(beatId)
        const shots = own.flatMap(c => c.shots)
        const marked = own.filter(c => all || clips.includes(c.clip)).flatMap(c => c.shots)
        const whole = all || !own.length || own.every(c => clips.includes(c.clip))
        const shotScope = (n: number) => ({kind: 'shot' as const, id: `${beatId}:shot${n}`})
        const newcomers = bringing.filter(id => !beat.characterIds.includes(id))
        for (const character of newcomers) {
            beat.characterIds.push(character)
            added.push({beat: beatId, character})
        }
        if (whole) {
            if (bringing.length)
                rule(
                    {kind: 'beat', id: beatId},
                    `${names(data, bringing)} ${isAre(bringing)} in this beat and seen in its shots${bringing.length > 1 ? ', each one their own person doing something of their own' : ''}.`,
                    {characters: bringing, in: true},
                )
            const out = without.filter(id => beat.characterIds.includes(id))
            if (out.length) {
                beat.characterIds = beat.characterIds.filter(id => !out.includes(id))
                for (const character of out) removed.push({beat: beatId, character})
                const who = names(data, out)
                rule(
                    {kind: 'beat', id: beatId},
                    `${who} ${isAre(out)} not in this beat: no shot shows ${out.length > 1 ? 'them' : who}, and nobody looks at, speaks to or touches ${out.length > 1 ? 'them' : who} - whatever the summary or the moments say.`,
                    {characters: out, in: false},
                )
            }
            if (note) rule({kind: 'beat', id: beatId}, note)
        } else {
            for (const n of marked) {
                shotsAbout.push(`${beatId}:shot${n}`)
                if (bringing.length) rule(shotScope(n), `${names(data, bringing)} ${isAre(bringing)} in this shot.`, {characters: bringing, in: true})
                const out = without.filter(id => beat.characterIds.includes(id))
                if (out.length) rule(shotScope(n), `${names(data, out)} ${isAre(out)} not in this shot.`, {characters: out, in: false})
                if (note) rule(shotScope(n), note)
            }
            // whoever came into the beat for some of its shots only is not in the others
            if (newcomers.length)
                for (const n of shots.filter(i => !marked.includes(i)))
                    rule(shotScope(n), `${names(data, newcomers)} ${isAre(newcomers)} not in this shot.`, {characters: newcomers, in: false})
        }
        // where everybody stands was planned with other people: the beat plans its floor plan with its shots (index.ts 11b)
        delete data.blocking?.[beatId]
    }
    const replanned = dropBeatPlans(data, beatIds)
    return {joined, remade, added, removed, replanned, beats: beatIds, ...(shotsAbout.length ? {shots: shotsAbout} : {}), castRules: rules}
}

/**
 * The saved rules with the new ones: an older presence rule on the same beat - or a shot of it - loses the people a new one is
 * about, and goes when nobody is left in it; so "in" and "not in" for the same person never stand side by side.
 */
export function mergeCastRules(rules: DirectionRule[], data: Project, fresh: CastRule[]): DirectionRule[] {
    const beatOf = (r: {scope: DirectionRule['scope']}) =>
        r.scope.kind === 'beat' ? r.scope.id : r.scope.kind === 'shot' ? r.scope.id.replace(/:shot\d+$/, '') : undefined
    const covers = (newer: CastRule, older: DirectionRule) =>
        beatOf(newer) === beatOf(older) &&
        (newer.scope.kind === 'beat' || older.scope.kind === 'beat' || (newer.scope as {id: string}).id === (older.scope as {id: string}).id)
    const kept = rules.flatMap(old => {
        if (!old.presence || beatOf(old) === undefined) return [old]
        const gone = new Set(fresh.filter(f => f.presence && covers(f, old)).flatMap(f => f.presence!.characters))
        const left = old.presence.characters.filter(c => !gone.has(c))
        if (left.length === old.presence.characters.length) return [old]
        if (!left.length) return []
        const who = names(data, left)
        const text = old.presence.in
            ? `${who} ${isAre(left)} in this ${old.scope.kind === 'beat' ? 'beat and seen in its shots' : 'shot'}.`
            : `${who} ${isAre(left)} not in this ${old.scope.kind === 'beat' ? 'beat' : 'shot'}.`
        return [{...old, text, presence: {...old.presence, characters: left}}]
    })
    return [...kept, ...fresh.map(r => ({id: randomUUID(), ...r}))]
}

/**
 * The change written: project.json (and casting.json for whoever joined), then the presence rules and the note as direction rules
 * on the beats or shots - saved for a beat without shots now, they hold for the shots the next plan run gives it.
 */
export async function writeBeatCast(target: EditorTarget, change: BeatCastChange, config?: ProjectConfig): Promise<BeatCastResult> {
    if (target.kind !== 'music') throw new Error('people are brought into beats of a music video; a film has its script')
    if (typeof change?.note === 'string' && change.note.trim().length > 2000) throw new Error('the note is longer than 2000 characters')
    const settings = config ?? (await loadProjectConfig(target.dir))
    let data: Project | undefined
    const applied = await withProjectLock(target.dir, target.id, () => {
        const file = join(target.dir, 'project.json')
        data = readJson<Project>(file)
        if (!data) throw new Error('no project.json yet - plan the project first')
        const before = structuredClone(data.cast)
        const applied = applyBeatCast(data, change, beatClips(data, settings))
        writeJsonFile(file, data)
        // casting.json follows who is in the cast: whoever joined runs as "project:" (bun run cast does the same)
        if (applied.joined.length && before && data.cast && existsSync(join(target.dir, CASTING_FILE))) {
            const casting = castingAfterCastChange(readCastingFile(target.dir), before, data.cast)
            if (casting) writeJsonFile(join(target.dir, CASTING_FILE), casting)
        }
        return applied
    })
    const {castRules: rules, ...result} = applied
    if (rules.length) {
        // for the planner, which plans these beats now: nothing to preview or take
        await setDirectionRules(target, {rules: mergeCastRules(readDirection(target).rules, data!, rules)})
        result.rules = rules.length
    }
    return result
}
