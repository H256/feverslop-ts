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
