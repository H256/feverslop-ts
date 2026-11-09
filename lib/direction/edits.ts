import type {DirectionEdit, DirectionShot, DirectionSize} from '../../shared/direction.ts'

// Direct edits (#735): choices the director makes in the plan itself - take a person out of a shot, set its size - applied by code
// to every shot their scope selects, no language model involved. They are kept apart from the plan like the rules, so a plan made
// again gets them too: the planner is told (directionNotes), and the code enforces them on what it wrote (applyEdit).

/** The framing words a shot size is written with - the size is what the code knows, the framing what the prompt says. */
export const SIZE_FRAMING: Record<DirectionSize, string> = {wide: 'wide shot', medium: 'medium shot', close: 'close-up', extreme: 'extreme close-up'}

export type EditResult = { data?: Record<string, unknown>, issue?: string, mentions?: boolean }

type Person = Record<string, unknown>

/** Whoever a shot cannot lose: who sings or plays in it, and in a film shot with dialogue everyone in it (the lines are theirs). */
export function keptIn(data: Record<string, unknown>): string[] {
    const people = (data.people ?? {}) as Record<string, Person>
    const performing = Object.entries(people).filter(([, p]) => p.singing === true || p.playing === true).map(([id]) => id)
    const speaking = Array.isArray(data.lines) && data.lines.length ? (data.characters ?? []) as string[] : []
    return [...new Set([...performing, ...speaking])]
}

/** Whether a shot's texts still name somebody: their {Name} token, or the name as a word (plans from before the tokens). */
export function namesIn(data: Record<string, unknown>, name: string, without?: string): boolean {
    const word = new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u')
    const texts: string[] = []
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && key !== 'hands') texts.push(value)
        if (key === 'people' && value && typeof value === 'object') {
            for (const [id, person] of Object.entries(value as Record<string, Person>)) {
                if (id === without) continue
                for (const text of Object.values(person)) if (typeof text === 'string') texts.push(text)
            }
        }
    }
    return texts.some(text => text.includes(`{${name}}`) || word.test(text))
}

/**
 * One edit on one shot's data, as a new object - undefined data when it changes nothing. Taking out somebody the shot cannot lose
 * is refused (issue). A shot whose texts still name the person taken out says so (mentions): those words are the language model's
 * to rewrite (the preview gets a rule for it), the code only takes the person out of who is in the picture.
 */
export function applyEdit(data: Record<string, unknown>, edit: DirectionEdit, nameOf: (id: string) => string, film: boolean): EditResult {
    if (edit.remove) {
        const id = edit.remove
        const characters = (data.characters ?? []) as string[]
        if (!characters.includes(id)) return {}
        if (keptIn(data).includes(id)) return {issue: `${nameOf(id)} ${film ? 'speaks' : 'sings or plays'} in this shot and stays in it`}
        const people = {...(data.people ?? {}) as Record<string, Person>}
        delete people[id]
        const next: Record<string, unknown> = {...data, characters: characters.filter(c => c !== id), ...(data.people ? {people} : {})}
        if (next.hands === id) delete next.hands
        return {data: next, mentions: namesIn(next, nameOf(id), id)}
    }
    if (edit.size) {
        const framing = SIZE_FRAMING[edit.size]
        if (data.framing === framing && (film || data.size === edit.size)) return {}
        return {data: {...data, framing, ...(film ? {} : {size: edit.size})}}
    }
    return {}
}

/** Whether an edit's scope takes in a shot (a time range: any shot that reaches into it). */
export function inScope(edit: DirectionEdit, shot: DirectionShot): boolean {
    const scope = edit.scope
    switch (scope.kind) {
        case 'global': return true
        case 'character': return shot.characters.includes(scope.id)
        case 'shot': return shot.id === scope.id
        case 'beat': case 'scene': return shot.groupId === scope.id
        case 'time': return shot.start !== undefined && shot.end !== undefined && shot.start < scope.end && shot.end > scope.start
    }
}

/** What an edit says, for a person to read - the CLI's list, the planner's notes. */
export function describeEdit(edit: DirectionEdit, nameOf: (id: string) => string): string {
    if (edit.remove) return `${nameOf(edit.remove)} is not in the picture`
    if (edit.size) return `the shot is a ${SIZE_FRAMING[edit.size]}`
    return 'nothing'
}

/**
 * The edits as notes for the planner, per beat or scene: what a plan made again must already keep to. A shot edit names its shot by
 * number; a time range is left to the code (the planner does not know the times of its shots).
 */
export function directionNotes(edits: DirectionEdit[], groups: string[], nameOf: (id: string) => string): Record<string, string[]> {
    const notes: Record<string, string[]> = {}
    const add = (group: string, note: string) => { (notes[group] ??= []).push(note) }
    for (const edit of edits) {
        const what = describeEdit(edit, nameOf)
        const scope = edit.scope
        if (scope.kind === 'shot') {
            const at = scope.id.lastIndexOf(':shot')
            if (at > 0) add(scope.id.slice(0, at), `in shot ${scope.id.slice(at + 5)}, ${what}`)
        } else if (scope.kind === 'beat' || scope.kind === 'scene') add(scope.id, `in every shot, ${what}`)
        else if (scope.kind === 'global') for (const group of groups) add(group, `in every shot, ${what}`)
        else if (scope.kind === 'character') for (const group of groups) add(group, `in every shot with ${nameOf(scope.id)}, ${what}`)
    }
    return notes
}
