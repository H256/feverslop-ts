import type {BeatShots, Character, ShotPlan, StoryBeat} from "./project.ts";
import {readTokens, tokenCharacter} from "./refs.ts";

// Reads what the shot planner (step 11b) answered for a beat. Nothing here understands words beyond the cast's own names:
// the planner reads the story and says who is in each shot and where they stand, the code resolves names to ids, counts,
// and asks again where the answer breaks a rule that can be counted.

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const SIZES = ['wide', 'medium', 'close'] as const
/** How many people a shot of a size class holds - the planner prompt says the same (lib/shot-planner.ts). */
const SHOT_ROOM: Record<(typeof SIZES)[number], number | undefined> = {close: 2, medium: 3, wide: undefined}
/** A flag the planner answered: true, or "yes" in the line format. */
const yes = (value: unknown) => value === true || (typeof value === 'string' && /^\s*(yes|true)\b/i.test(value))
/** The planner's "playing:" - what the hands do on the instrument (a phrase), a bare "yes", or "no" / nothing. */
function playingOf(value: unknown): { playing?: true, plays?: string } {
    if (value === true) return {playing: true}
    const t = text(value).replace(/^["']+|["'.]+$/g, '').trim()
    if (!t || /^(no|not|none|false)\b/i.test(t)) return {}
    const plays = t.replace(/^(yes|true)\b[\s,;:-]*/i, '')
    return plays ? {playing: true, plays} : {playing: true}
}

/** Does the text name this character (by name or id, as a whole word)? */
export const mentionsCharacter = (value: string, character: Pick<Character, 'name' | 'id'>) =>
    [character.name, character.id].some(n => n.length > 1 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'iu').test(value))

/** A plan from before the staging was a list of actions - it still works, with only the actions. */
export const asBeatShots = (value: BeatShots | string[]): BeatShots =>
    Array.isArray(value) ? {shots: value.map(action => ({action}))} : value

/** The character the planner meant by this name (exact, case-insensitive), or by the id - braces around it are the token's. */
const characterOf = (characters: Character[], who: string) => tokenCharacter(characters, who.trim().replace(/^\{(.*)\}$/, '$1'))

/**
 * problems: what asking again can fix and a shot cannot do without (a name that is not in the cast, a singing shot without
 * its singer, three people in unison). notes: what the code repaired or what is only worth a line in the log - they never
 * cost another planner call, so a rule that is nice to have can not keep the run from going on.
 */
export type ReadPlan = { plan: BeatShots, problems: string[], notes: string[], issues: Issue[] }
/** A problem with the shot it is in (0-based) - none for a problem of the whole beat (its shot count): asked again for those shots only. */
export type Issue = { shot?: number, message: string }

/** The most people a shot gives an own entry to, and shows at once unless it is a wide shot. */
export const MAX_FOREGROUND = 4
/** From how many people with the same motion in one shot the planner is asked again. */
const UNISON_ASKS = 3
const normalized = (value: string | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const nameOfId = (characters: Character[], id: string) => characters.find(c => c.id === id)?.name ?? id

/**
 * Two named people of one shot who are given the same motion (or the same state and the same frame) are in unison -
 * the video model then plays one movement five times, in the same beat. A crowd entry (isGroup) is one entry for
 * several bodies and is not compared; what it does is the prompt's to say.
 */
function unisonChecks(j: number, people: NonNullable<ShotPlan['people']>, characters: Character[]): { problems: string[], notes: string[] } {
    const named = Object.entries(people).filter(([id]) => !characters.find(c => c.id === id)?.isGroup)
    const byMotion = new Map<string, string[]>()
    for (const [id, p] of named) {
        const same = normalized(p.motion)
        const key = same.split(' ').length >= 2 ? `motion:${same}` : p.state && p.frame ? `place:${normalized(p.state)}|${normalized(p.frame)}` : ''
        if (key) byMotion.set(key, [...(byMotion.get(key) ?? []), id])
    }
    const problems: string[] = []
    const notes: string[] = []
    for (const ids of byMotion.values()) {
        if (ids.length < 2) continue
        const line = `shot ${j + 1}: ${ids.map(id => nameOfId(characters, id)).join(', ')} have the same motion or place`
        // three or more is a chorus line and is asked again; two alike is a note
        if (ids.length >= UNISON_ASKS) problems.push(`${line} - give each of them their own action, direction and timing`)
        else notes.push(line)
    }
    return {problems, notes}
}

/** Who sings in shot j: the singers of the lines sung in it - all of the beat's singers for an input from before singersPerShot. */
export type ShotSingers = { singerIds: string[], singingPerShot: boolean[], singersPerShot?: string[][] }
export type ShotProps = { characterId: string, prop: string, activePerShot: boolean[] }[]
const sungBy = (singers: ShotSingers | undefined, j: number) => singers?.singersPerShot?.[j] ?? (singers?.singingPerShot[j] ? singers.singerIds : [])

/**
 * What the music says against the people of shot j, by their own "singing:" and "playing:" fields - never by the words of
 * the text: who sings in it is "singing: yes" and nobody else, whose instrument is heard says in "playing:" what the hands
 * do on it (a bare "yes" is asked again: the flag alone came with an idle motion in about half of the shots) and nobody
 * else plays. Asked again once: the clip prompt follows the music, and a plan that says otherwise (a verse of the lead sung "in
 * tight harmony", a guitar "resting on his thigh" while it is heard) wins over it in the picture.
 */
function musicChecks(j: number, people: NonNullable<ShotPlan['people']>, characters: Character[], singers?: ShotSingers, props?: ShotProps): string[] {
    const problems: string[] = []
    const singing = sungBy(singers, j)
    const who = singing.length ? singing.map(id => nameOfId(characters, id)).join(' and ') : 'nobody'
    for (const [id, p] of Object.entries(people)) {
        const name = nameOfId(characters, id)
        if (p.singing === true && !singing.includes(id)) problems.push(`shot ${j + 1}: ${name} is marked singing, but ${who} sings in this shot - singing: no for ${name}, and no singing, joining in or mouthing the words by ${name} anywhere in the shot`)
        if (p.singing !== true && singing.includes(id)) problems.push(`shot ${j + 1}: ${name} sings in this shot - singing: yes, the mouth in view, singing into the microphone if ${name} has one`)
        const instrument = props?.find(e => e.characterId === id)
        if (!instrument) continue
        const heard = instrument.activePerShot[j] === true
        if (heard && p.playing !== true) problems.push(`shot ${j + 1}: ${name}'s ${instrument.prop} is heard in this shot - playing: <what ${name}'s hands do on the ${instrument.prop} in this shot>, and ${name} plays it in the shot, staged however fits the moment`)
        else if (heard && !p.plays) problems.push(`shot ${j + 1}: ${name}'s ${instrument.prop} is heard in this shot - playing: says only yes; write what ${name}'s hands do on the ${instrument.prop} in this shot instead`)
        if (!heard && p.playing === true) problems.push(`shot ${j + 1}: ${name}'s ${instrument.prop} is not heard in this shot - playing: no, and ${name} does something else with it or with their hands`)
    }
    return problems
}

/**
 * More own entries than MAX_FOREGROUND in a shot: the code keeps the ones the shot is about - the singers of the shot
 * first, then in the order the shot's action names them - and drops the rest of the entries. The dropped stay in the
 * shot's characters, in the picture without a direction of their own, instead of costing another planner call.
 */
function trimForeground(people: NonNullable<ShotPlan['people']>, action: string, characters: Character[], singing: string[]): { people: NonNullable<ShotPlan['people']>, dropped: string[] } {
    const ids = Object.keys(people)
    if (ids.length <= MAX_FOREGROUND) return {people, dropped: []}
    // in the order of the action's tokens: who it names first, it is about first
    const named = readTokens(action, characters).ids
    const at = (id: string) => named.includes(id) ? named.indexOf(id) : Number.MAX_SAFE_INTEGER
    const ranked = [...ids].sort((a, b) => Number(singing.includes(b)) - Number(singing.includes(a)) || at(a) - at(b) || ids.indexOf(a) - ids.indexOf(b))
    const keep = new Set(ranked.slice(0, MAX_FOREGROUND))
    return {people: Object.fromEntries(ids.filter(id => keep.has(id)).map(id => [id, people[id]!])), dropped: ids.filter(id => !keep.has(id))}
}

/** Whose instrument is heard in shot j. */
const heardIn = (props: ShotProps | undefined, j: number) => (props ?? []).filter(p => p.activePerShot[j] === true).map(p => p.characterId)

/**
 * A shot with more people than its size holds. "Leave out who the shot is not about" was not enough - the planner kept all
 * four of a band in medium shots, and a singer in a guitar solo sang in it with her mouth wide open. So the code picks who
 * stays, from the data alone: who sings in the shot, whose instrument is heard, then who the action names first - and the
 * problem names the others, heard off camera. If someone who sings or is heard has to go, a wide shot is offered instead.
 */
function crowdedShot(j: number, ids: string[], size: string, room: number, action: string, characters: Character[], singing: string[], heard: string[]): string {
    const named = readTokens(action, characters).ids
    const at = (id: string) => named.includes(id) ? named.indexOf(id) : Number.MAX_SAFE_INTEGER
    const rank = (id: string) => singing.includes(id) ? 0 : heard.includes(id) ? 1 : 2
    const ranked = [...ids].sort((a, b) => rank(a) - rank(b) || at(a) - at(b) || ids.indexOf(a) - ids.indexOf(b))
    const names = (list: string[]) => list.map(id => nameOfId(characters, id)).join(', ')
    const keep = ids.filter(id => ranked.indexOf(id) < room)
    const leave = ids.filter(id => ranked.indexOf(id) >= room)
    const needed = leave.filter(id => rank(id) < 2)
    return `shot ${j + 1}: ${ids.length} people (${names(ids)}) in a ${size} shot, which holds at most ${room} - the shot is about ${names(keep)}: ` +
        `take ${names(leave)} out of its "characters" and "people" and do not name them in its "action" or "rest" - heard is not seen, they are off camera` +
        (needed.length ? `; or make it a wide shot, since ${names(needed)} ${needed.length > 1 ? 'are' : 'is'} heard in it` : '')
}

export function readBeatPlan(raw: unknown, beat: StoryBeat, characters: Character[], needed: number, singers?: ShotSingers, props?: ShotProps): ReadPlan | undefined {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
    const rawShots = Array.isArray(raw) ? raw : o && Array.isArray(o.shots) ? o.shots : undefined
    if (!rawShots?.length) return undefined
    const issues: Issue[] = []
    const notes: string[] = []
    const onScreen = characters.filter(c => beat.characterIds.includes(c.id))
    const problem = (shot: number | undefined, message: string) => issues.push({...(shot !== undefined ? {shot} : {}), message})

    const shots = rawShots.map((entry, j): ShotPlan => {
        const e: Record<string, unknown> = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {action: entry}
        const action = text(e.action)
        const names = Array.isArray(e.characters) ? e.characters.map(text).filter(Boolean) : []
        const ids = [...new Set(names.flatMap(name => {
            const found = characterOf(characters, name)
            if (!found) problem(j, `shot ${j + 1}: "${name}" is not one of the characters`)
            return found ? [found.id] : []
        }))]
        let people: NonNullable<ShotPlan['people']> = {}
        if (e.people && typeof e.people === 'object' && !Array.isArray(e.people)) {
            for (const [who, entry] of Object.entries(e.people as Record<string, unknown>)) {
                const found = characterOf(characters, who)
                const p = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
                if (!found || !(text(p.state) || text(p.frame) || text(p.motion))) continue
                // somebody described but not listed is in the picture too
                if (!ids.includes(found.id)) ids.push(found.id)
                people[found.id] = {...(text(p.state) ? {state: text(p.state)} : {}), ...(text(p.frame) ? {frame: text(p.frame)} : {}), ...(text(p.motion) ? {motion: text(p.motion)} : {}), ...(yes(p.singing) ? {singing: true} : {}), ...playingOf(p.playing)}
            }
        }
        const trimmed = trimForeground(people, action, characters, sungBy(singers, j))
        if (trimmed.dropped.length) {
            people = trimmed.people
            notes.push(`shot ${j + 1}: ${trimmed.dropped.length + MAX_FOREGROUND} people had an own entry - ${trimmed.dropped.map(id => nameOfId(characters, id)).join(', ')} kept without one`)
        }
        // the shot's text names someone who is not in it: the video model draws a stranger for a name without a picture -
        // read from the tokens of the text ({Name}), and a token that is nobody of the cast is asked again
        const written = readTokens([action, text(e.view), text(e.camera), text(e.rest), ...Object.values(people).flatMap(p => [p.state ?? '', p.frame ?? '', p.motion ?? ''])].join(' '), characters)
        for (const token of written.unknown) problem(j, `shot ${j + 1}: "{${token}}" is not one of the characters - write the names of the cast in braces, exactly as in "cast"`)
        const strangers = onScreen.filter(c => !ids.includes(c.id) && written.ids.includes(c.id)).map(c => c.name)
        if (strangers.length) problem(j, `shot ${j + 1}: the text names ${strangers.join(', ')}, who ${strangers.length > 1 ? 'are' : 'is'} not in the shot's characters - leave them out of the text, or put them in the shot`)
        // while a line is sung, a singer is in the picture
        const lineSingers = sungBy(singers, j)
        if (lineSingers.length && !lineSingers.some(id => ids.includes(id)))
            problem(j, `shot ${j + 1}: a line of ${lineSingers.map(id => nameOfId(characters, id)).join(' and ')} is sung in it, but they are not in its characters`)
        const unison = unisonChecks(j, people, characters)
        for (const message of [...unison.problems, ...musicChecks(j, people, characters, singers, props)]) problem(j, message)
        notes.push(...unison.notes)
        const size = SIZES.find(s => s === text(e.size).toLowerCase())
        // a framing that cannot hold its people: the video model squeezes them together - it pulled a drummer away from
        // her kit, dropped the singer and shrank the faces when a "medium close-up" had all four of a band in it
        const room = size ? SHOT_ROOM[size] : undefined
        if (room !== undefined && ids.length > room) problem(j, crowdedShot(j, ids, size!, room, action, characters, sungBy(singers, j), heardIn(props, j)))
        else if (ids.length > MAX_FOREGROUND && size !== 'wide') notes.push(`shot ${j + 1}: ${ids.length} people in a "${text(e.framing) || 'shot'}" (size ${size ?? 'not given'})`)
        // three or more people: everybody moves (the prompt asks for it) - what the code can tell without reading the
        // words is a person with an entry of their own and no motion, who is then left standing in the reference pose
        const motionless = ids.filter(id => people[id] && !people[id]!.motion)
        if (ids.length >= 3 && motionless.length) notes.push(`shot ${j + 1}: ${motionless.map(id => nameOfId(characters, id)).join(', ')} ${motionless.length > 1 ? 'have' : 'has'} no motion in a shot of ${ids.length} people`)
        return {
            action,
            ...(text(e.framing) ? {framing: text(e.framing)} : {}),
            ...(text(e.camera) ? {camera: text(e.camera)} : {}),
            ...(text(e.view) ? {view: text(e.view)} : {}),
            ...(e.hold === true ? {hold: true} : {}),
            ...(size ? {size} : {}),
            ...(yes(e.risky) ? {risky: true} : {}),
            ...(ids.length ? {characters: ids} : {}),
            ...(Object.keys(people).length ? {people} : {}),
            ...(text(e.rest) ? {rest: text(e.rest)} : {}),
        }
    })
    shots.forEach((s, j) => {
        if (!s.action) problem(j, `shot ${j + 1}: every shot needs an action`)
    })

    const ends: Record<string, string> = {}
    if (o?.ends && typeof o.ends === 'object' && !Array.isArray(o.ends)) {
        for (const [who, where] of Object.entries(o.ends as Record<string, unknown>)) {
            const found = characterOf(characters, who)
            if (found && text(where)) ends[found.id] = text(where)
        }
    }
    // padded or cut below so the run goes on, but the planner is asked again: repeated shots read as "the same action, closer"
    if (shots.length !== needed) problem(undefined, `shot count: needed ${needed}, got ${shots.length}`)
    const sized = Array.from({length: needed}, (_, j) => shots[Math.min(j, shots.length - 1)]!)
    for (const token of readTokens(text(o?.staging), characters).unknown) problem(0, `the staging: "{${token}}" is not one of the characters - write the names of the cast in braces, exactly as in "cast"`)
    return {notes, plan: {...(text(o?.staging) ? {staging: text(o?.staging)} : {}), ...(Object.keys(ends).length ? {ends} : {}), shots: sized, tokens: true}, problems: issues.map(i => i.message), issues}
}

/**
 * The planner's answer in the line format (index.ts, step 11b) as the object readBeatPlan reads. One field per line:
 *   STAGING: ...            (first call of a beat)
 *   SHOT 1
 *   framing: / size: wide|medium|close / camera: / view: / hold: yes|no / risky: yes|no / characters: A, B / action: ... / rest: ...
 *   person: A | state: ... | frame: ... | motion: ... | playing: <what the hands do on the instrument>|no | singing: yes|no
 *   START                   (the blocking call)
 *   start: A | where they are when the beat starts
 *   ENDS
 *   end: A | where they are when the beat is over
 * Lines of JSON are no better than a quote in the middle of a sentence, and a broken bracket cost a whole beat; here
 * a line that does not fit is just skipped. Markdown around a key (bullets, bold, fences) is tolerated.
 */
export function parseShotLines(answer: string): { staging?: string, starts: Record<string, string>, ends: Record<string, string>, shots: Record<string, unknown>[] } {
    const shots: Record<string, unknown>[] = []
    const starts: Record<string, string> = {}
    const ends: Record<string, string> = {}
    let staging: string | undefined
    let current: Record<string, unknown> | undefined
    let inEnds = false
    for (const rawLine of answer.split(/\r?\n/)) {
        const line = rawLine.replace(/^\s*(?:[-*>]\s+|\d+\.\s+)?/, '').replace(/\*\*/g, '').replace(/^`+|`+$/g, '').trim()
        if (!line || /^```/.test(line)) continue
        let m: RegExpMatchArray | null
        if ((m = line.match(/^staging\s*:\s*(.*)$/i))) { staging = m[1]!.trim(); inEnds = false; continue }
        if (/^shot\s*\d+\s*[:.\-]?\s*$/i.test(line)) {
            current = {characters: [] as string[], people: {} as Record<string, unknown>}
            shots.push(current)
            inEnds = false
            continue
        }
        if (/^ends\s*:?\s*$/i.test(line)) { inEnds = true; current = undefined; continue }
        if ((m = line.match(/^end\s*:\s*([^|]+?)\s*\|\s*(.+)$/i))) { ends[m[1]!.trim()] = m[2]!.trim(); continue }
        if ((m = line.match(/^start\s*:\s*([^|]+?)\s*\|\s*(.+)$/i))) { starts[m[1]!.trim()] = m[2]!.trim(); continue }
        if (/^start\s*:?\s*$/i.test(line)) { inEnds = false; current = undefined; continue }
        if (inEnds || !current) continue
        if ((m = line.match(/^person\s*:\s*(.+)$/i))) {
            const parts = m[1]!.split(/\s*\|\s*(?=(?:state|frame|motion|playing|singing)\s*:)/i)
            const name = parts[0]!.trim()
            const entry: Record<string, string> = {}
            for (const part of parts.slice(1)) {
                const kv = part.match(/^(state|frame|motion|playing|singing)\s*:\s*(.*)$/i)
                if (kv) entry[kv[1]!.toLowerCase()] = kv[2]!.trim()
            }
            if (name) (current.people as Record<string, unknown>)[name] = entry
            continue
        }
        if ((m = line.match(/^(framing|size|camera|view|hold|risky|characters|action|rest)\s*:\s*(.*)$/i))) {
            const key = m[1]!.toLowerCase()
            const value = m[2]!.trim()
            if (key === 'hold') current.hold = /^(yes|true)\b/i.test(value)
            else if (key === 'risky') current.risky = /^(yes|true)\b/i.test(value)
            else if (key === 'characters') current.characters = value.split(/\s*,\s*|\s+and\s+/).map(v => v.trim()).filter(Boolean)
            else current[key] = value
        }
    }
    return {...(staging ? {staging} : {}), starts, ends, shots}
}
