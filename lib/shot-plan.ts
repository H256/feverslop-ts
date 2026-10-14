import type {BeatShots, Character, ShotPlan, StoryBeat} from "./project.ts";

// Reads what the shot planner (step 11b) answered for a beat. Nothing here understands words beyond the cast's own names:
// the planner reads the story and says who is in each shot and where they stand, the code resolves names to ids, counts,
// and asks again where the answer breaks a rule that can be counted.

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/** Does the text name this character (by name or id, as a whole word)? */
export const mentionsCharacter = (value: string, character: Pick<Character, 'name' | 'id'>) =>
    [character.name, character.id].some(n => n.length > 1 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'iu').test(value))

/** A plan from before the staging was a list of actions - it still works, with only the actions. */
export const asBeatShots = (value: BeatShots | string[]): BeatShots =>
    Array.isArray(value) ? {shots: value.map(action => ({action}))} : value

/** The character the planner meant by this name (exact, case-insensitive), or by the id. */
const characterOf = (characters: Character[], who: string) => {
    const wanted = who.trim().toLowerCase()
    return characters.find(c => c.name.toLowerCase() === wanted || c.id.toLowerCase() === wanted)
}

export type ReadPlan = { plan: BeatShots, problems: string[] }

/** The most people a shot gives an own entry to, and shows at once unless it is a wide shot. */
export const MAX_FOREGROUND = 4
const WIDE = /\b(?:wide|establishing|long shot|panoram\w*|aerial|overhead|high-angle)\b/i

const normalized = (value: string | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const nameOfId = (characters: Character[], id: string) => characters.find(c => c.id === id)?.name ?? id

/**
 * Two named people of one shot who are given the same motion (or the same state and the same frame) are in unison -
 * the video model then plays one movement five times, in the same beat. A crowd entry (isGroup) is one entry for
 * several bodies and is not compared; what it does is the prompt's to say.
 */
function unisonProblems(j: number, people: NonNullable<ShotPlan['people']>, characters: Character[]): string[] {
    const named = Object.entries(people).filter(([id]) => !characters.find(c => c.id === id)?.isGroup)
    const byMotion = new Map<string, string[]>()
    for (const [id, p] of named) {
        const same = normalized(p.motion)
        const key = same.split(' ').length >= 2 ? `motion:${same}` : p.state && p.frame ? `place:${normalized(p.state)}|${normalized(p.frame)}` : ''
        if (key) byMotion.set(key, [...(byMotion.get(key) ?? []), id])
    }
    return [...byMotion.values()].filter(ids => ids.length > 1).map(ids =>
        `shot ${j + 1}: ${ids.map(id => nameOfId(characters, id)).join(', ')} have the same motion or place - give each of them their own action, direction and timing`)
}

const SINGING = /\b(?:sings?|singing|sang|lip-?sync\w*|mouths? (?:is |are )?open on the (?:verse|chorus|line|lyrics?)|on the (?:verse|chorus))\b/i

/** Someone who does not sing in this shot is not described singing: the video model moves their lips to the vocals. */
function singingProblems(j: number, people: NonNullable<ShotPlan['people']>, characters: Character[], singers?: { singerIds: string[], singingPerShot: boolean[] }): string[] {
    if (!singers) return []
    const allowed = singers.singingPerShot[j] ? singers.singerIds : []
    return Object.entries(people)
        .filter(([id, p]) => !allowed.includes(id) && SINGING.test([p.state, p.frame, p.motion].filter(Boolean).join(' ')))
        .map(([id]) => `shot ${j + 1}: ${nameOfId(characters, id)} does not sing in this shot - no singing, lip movement or "mouth open on the verse" for them`)
}

/**
 * The planner's answer for one beat as a BeatShots, padded or cut to `needed` shots. `problems` are what asking again can fix:
 * a name that is not in the cast, nobody of the singers in a shot where a line is sung, a shot that names someone it does not show.
 */
export function readBeatPlan(raw: unknown, beat: StoryBeat, characters: Character[], needed: number, singers?: { singerIds: string[], singingPerShot: boolean[] }): ReadPlan | undefined {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
    const rawShots = Array.isArray(raw) ? raw : o && Array.isArray(o.shots) ? o.shots : undefined
    if (!rawShots?.length) return undefined
    const problems: string[] = []
    const onScreen = characters.filter(c => beat.characterIds.includes(c.id))

    const shots = rawShots.map((entry, j): ShotPlan => {
        const e: Record<string, unknown> = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {action: entry}
        const action = text(e.action)
        const names = Array.isArray(e.characters) ? e.characters.map(text).filter(Boolean) : []
        const ids = [...new Set(names.flatMap(name => {
            const found = characterOf(characters, name)
            if (!found) problems.push(`shot ${j + 1}: "${name}" is not one of the characters`)
            return found ? [found.id] : []
        }))]
        const people: NonNullable<ShotPlan['people']> = {}
        if (e.people && typeof e.people === 'object' && !Array.isArray(e.people)) {
            for (const [who, entry] of Object.entries(e.people as Record<string, unknown>)) {
                const found = characterOf(characters, who)
                const p = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
                if (!found || !(text(p.state) || text(p.frame) || text(p.motion))) continue
                // somebody described but not listed is in the picture too
                if (!ids.includes(found.id)) ids.push(found.id)
                people[found.id] = {...(text(p.state) ? {state: text(p.state)} : {}), ...(text(p.frame) ? {frame: text(p.frame)} : {}), ...(text(p.motion) ? {motion: text(p.motion)} : {})}
            }
        }
        // the shot's text names someone who is not in it: the video model draws a stranger for a name without a picture
        const written = [action, text(e.view), ...Object.values(people).flatMap(p => [p.state ?? '', p.frame ?? '', p.motion ?? ''])].join(' ')
        const strangers = onScreen.filter(c => !ids.includes(c.id) && mentionsCharacter(written, c)).map(c => c.name)
        if (strangers.length) problems.push(`shot ${j + 1}: the text names ${strangers.join(', ')}, who ${strangers.length > 1 ? 'are' : 'is'} not in the shot's characters - leave them out of the text, or put them in the shot`)
        // while a line is sung, a singer is in the picture
        if (singers?.singingPerShot[j] && singers.singerIds.length && !singers.singerIds.some(id => ids.includes(id)))
            problems.push(`shot ${j + 1}: a line is sung in it, but none of the singers is in its characters`)
        problems.push(...unisonProblems(j, people, characters), ...singingProblems(j, people, characters, singers))
        const entries = Object.keys(people).length
        if (entries > MAX_FOREGROUND)
            problems.push(`shot ${j + 1}: ${entries} people have their own entry - at most ${MAX_FOREGROUND}: the ones the shot is about, the others stay in "characters" without an entry`)
        const framing = text(e.framing)
        if (ids.length > MAX_FOREGROUND && !WIDE.test(framing))
            problems.push(`shot ${j + 1}: ${ids.length} people in a "${framing || 'shot'}" - only a wide or establishing shot shows more than ${MAX_FOREGROUND}; leave the others out of "characters"`)
        return {
            action,
            ...(text(e.framing) ? {framing: text(e.framing)} : {}),
            ...(text(e.camera) ? {camera: text(e.camera)} : {}),
            ...(text(e.view) ? {view: text(e.view)} : {}),
            ...(e.hold === true ? {hold: true} : {}),
            ...(ids.length ? {characters: ids} : {}),
            ...(Object.keys(people).length ? {people} : {}),
        }
    })
    if (shots.some(s => !s.action)) problems.push('every shot needs an action')

    const ends: Record<string, string> = {}
    if (o?.ends && typeof o.ends === 'object' && !Array.isArray(o.ends)) {
        for (const [who, where] of Object.entries(o.ends as Record<string, unknown>)) {
            const found = characterOf(characters, who)
            if (found && text(where)) ends[found.id] = text(where)
        }
    }
    const sized = Array.from({length: needed}, (_, j) => shots[Math.min(j, shots.length - 1)]!)
    return {plan: {...(text(o?.staging) ? {staging: text(o?.staging)} : {}), ...(Object.keys(ends).length ? {ends} : {}), shots: sized}, problems}
}
