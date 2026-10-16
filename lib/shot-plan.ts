import type {BeatShots, Character, ShotPlan, StoryBeat} from "./project.ts";

// Reads what the shot planner (step 11b) answered for a beat. Nothing here understands words beyond the cast's own names:
// the planner reads the story and says who is in each shot and where they stand, the code resolves names to ids, counts,
// and asks again where the answer breaks a rule that can be counted.

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const SIZES = ['wide', 'medium', 'close'] as const
/** A flag the planner answered: true, or "yes" in the line format. */
const yes = (value: unknown) => value === true || (typeof value === 'string' && /^\s*(yes|true)\b/i.test(value))

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

/** Someone who does not sing in this shot is marked as singing by the planner: a note - the clip prompt keeps their mouth closed anyway. */
function singingNotes(j: number, people: NonNullable<ShotPlan['people']>, characters: Character[], singers?: { singerIds: string[], singingPerShot: boolean[] }): string[] {
    if (!singers) return []
    const allowed = singers.singingPerShot[j] ? singers.singerIds : []
    return Object.entries(people)
        .filter(([id, p]) => !allowed.includes(id) && p.singing === true)
        .map(([id]) => `shot ${j + 1}: ${nameOfId(characters, id)} is described singing but does not sing in this shot`)
}

/**
 * More own entries than MAX_FOREGROUND in a shot: the code keeps the ones the shot is about - the singers of the shot
 * first, then in the order the shot's action names them - and drops the rest of the entries. The dropped stay in the
 * shot's characters, in the picture without a direction of their own, instead of costing another planner call.
 */
function trimForeground(people: NonNullable<ShotPlan['people']>, action: string, characters: Character[], singing: string[]): { people: NonNullable<ShotPlan['people']>, dropped: string[] } {
    const ids = Object.keys(people)
    if (ids.length <= MAX_FOREGROUND) return {people, dropped: []}
    const at = (id: string) => {
        const c = characters.find(x => x.id === id)
        const i = c ? [c.name, c.id].map(n => action.toLowerCase().indexOf(n.toLowerCase())).filter(k => k >= 0).sort((a, b) => a - b)[0] : undefined
        return i ?? Number.MAX_SAFE_INTEGER
    }
    const ranked = [...ids].sort((a, b) => Number(singing.includes(b)) - Number(singing.includes(a)) || at(a) - at(b) || ids.indexOf(a) - ids.indexOf(b))
    const keep = new Set(ranked.slice(0, MAX_FOREGROUND))
    return {people: Object.fromEntries(ids.filter(id => keep.has(id)).map(id => [id, people[id]!])), dropped: ids.filter(id => !keep.has(id))}
}

export function readBeatPlan(raw: unknown, beat: StoryBeat, characters: Character[], needed: number, singers?: { singerIds: string[], singingPerShot: boolean[] }): ReadPlan | undefined {
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
                people[found.id] = {...(text(p.state) ? {state: text(p.state)} : {}), ...(text(p.frame) ? {frame: text(p.frame)} : {}), ...(text(p.motion) ? {motion: text(p.motion)} : {}), ...(yes(p.singing) ? {singing: true} : {})}
            }
        }
        const trimmed = trimForeground(people, action, characters, singers?.singingPerShot[j] ? singers.singerIds : [])
        if (trimmed.dropped.length) {
            people = trimmed.people
            notes.push(`shot ${j + 1}: ${trimmed.dropped.length + MAX_FOREGROUND} people had an own entry - ${trimmed.dropped.map(id => nameOfId(characters, id)).join(', ')} kept without one`)
        }
        // the shot's text names someone who is not in it: the video model draws a stranger for a name without a picture
        const written = [action, text(e.view), ...Object.values(people).flatMap(p => [p.state ?? '', p.frame ?? '', p.motion ?? ''])].join(' ')
        const strangers = onScreen.filter(c => !ids.includes(c.id) && mentionsCharacter(written, c)).map(c => c.name)
        if (strangers.length) problem(j, `shot ${j + 1}: the text names ${strangers.join(', ')}, who ${strangers.length > 1 ? 'are' : 'is'} not in the shot's characters - leave them out of the text, or put them in the shot`)
        // while a line is sung, a singer is in the picture
        if (singers?.singingPerShot[j] && singers.singerIds.length && !singers.singerIds.some(id => ids.includes(id)))
            problem(j, `shot ${j + 1}: a line is sung in it, but none of the singers is in its characters`)
        const unison = unisonChecks(j, people, characters)
        for (const message of unison.problems) problem(j, message)
        notes.push(...unison.notes, ...singingNotes(j, people, characters, singers))
        const size = SIZES.find(s => s === text(e.size).toLowerCase())
        if (ids.length > MAX_FOREGROUND && size !== 'wide') notes.push(`shot ${j + 1}: ${ids.length} people in a "${text(e.framing) || 'shot'}" (size ${size ?? 'not given'})`)
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
    return {notes, plan: {...(text(o?.staging) ? {staging: text(o?.staging)} : {}), ...(Object.keys(ends).length ? {ends} : {}), shots: sized}, problems: issues.map(i => i.message), issues}
}

/**
 * The planner's answer in the line format (index.ts, step 11b) as the object readBeatPlan reads. One field per line:
 *   STAGING: ...            (first call of a beat)
 *   SHOT 1
 *   framing: / size: wide|medium|close / camera: / view: / hold: yes|no / risky: yes|no / characters: A, B / action: ... / rest: ...
 *   person: A | state: ... | frame: ... | motion: ... | singing: yes|no
 *   ENDS
 *   end: A | where they are when the beat is over
 * Lines of JSON are no better than a quote in the middle of a sentence, and a broken bracket cost a whole beat; here
 * a line that does not fit is just skipped. Markdown around a key (bullets, bold, fences) is tolerated.
 */
export function parseShotLines(answer: string): { staging?: string, ends: Record<string, string>, shots: Record<string, unknown>[] } {
    const shots: Record<string, unknown>[] = []
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
        if (inEnds || !current) continue
        if ((m = line.match(/^person\s*:\s*(.+)$/i))) {
            const parts = m[1]!.split(/\s*\|\s*(?=(?:state|frame|motion|singing)\s*:)/i)
            const name = parts[0]!.trim()
            const entry: Record<string, string> = {}
            for (const part of parts.slice(1)) {
                const kv = part.match(/^(state|frame|motion|singing)\s*:\s*(.*)$/i)
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
    return {...(staging ? {staging} : {}), ends, shots}
}
