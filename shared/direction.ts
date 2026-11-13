/** Verbatim intent; bindings are generated when a scoped rule is saved, never inferred from reused IDs. */
export type DirectionScope =
    | {
          kind: 'global'
      }
    | {
          kind: 'character' | 'beat' | 'scene' | 'shot'
          id: string
      }
    | {
          kind: 'time'
          start: number
          end: number
      }
export type DirectionRule = {
    id: string
    text: string
    scope: DirectionScope
    characterId?: string
    binding?: string
    // for the planner only (#765): kept to when the shots of its scope are planned again, never previewed or reviewed
    planned?: boolean
    // who is or is not in the beat or shot of its scope (#767) - written with the text by "people in shots"; a newer one for the same
    // person on the same beat or shot replaces it
    presence?: {characters: string[]; in: boolean}
}
export type DirectionSize = 'wide' | 'medium' | 'close' | 'extreme'
/**
 * A choice made in the plan itself, without the language model (#735): `remove` takes a character out of the picture, `size` sets the
 * shot size - one of them. Applied by code to every shot the scope selects, also after the shots are planned again; a shot scope is
 * bound to the shot it was chosen for like a rule.
 */
export type DirectionEdit = {
    id: string
    scope: DirectionScope
    remove?: string
    /** a person of the cast brought into one shot (#792): the code puts them in, the preview writes what they do there */
    add?: string
    size?: DirectionSize
    binding?: string
}
export type DirectionShot = {
    id: string
    groupId: string
    characters: string[]
    start?: number
    end?: number
    data: Record<string, unknown>
}
export type DirectionChange = {
    shotId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
}
export type DirectionProposal = {
    id: string
    sourceFingerprint: string
    rulesFingerprint: string
    changes: DirectionChange[]
    conflicts: string[]
}
export type DirectionVersion = DirectionProposal & {
    createdAt: string
}
export type DirectionView = {
    rules: DirectionRule[]
    edits: DirectionEdit[]
    /** What an edit could not do, or left for the language model: a shot whose texts still name a person taken out of it. */
    editIssues: {
        editId: string
        shotId?: string
        message: string
        mentions?: boolean
        /** someone brought in who has nothing to do in the shot yet: the words are to be written in, not rewritten (#830) */
        idle?: boolean
        /** made for a shot that has been planned again since: it no longer applies, there is nothing to decide but clearing it */
        stale?: boolean
    }[]
    shots: DirectionShot[]
    characters: {
        id: string
        name: string
    }[]
    groups: {
        id: string
        label: string
    }[]
    unresolved: {
        ruleId: string
        message: string
        /** made for shots that were planned again since: a leftover of the old plan, nothing to decide (#830) */
        stale?: boolean
    }[]
    /** the reviewed rules the shots they select were all planned with (#960): taken by the plan run, nothing to preview */
    inPlan: string[]
    proposal?: DirectionProposal
    versions: DirectionVersion[]
    activeVersion?: string
    pending: boolean
    restored: boolean
    proposalStale?: boolean
}

/**
 * The words for the fields of a shot and of each person in it (#839): one table for the Direction page, the shot dialog and
 * `bun run direction --show`, so that the page and the terminal name a field the same. In the order a shot is read.
 */
export const SHOT_FIELDS = {
    action: 'Action',
    framing: 'Framing',
    camera: 'Camera',
    view: 'Camera position',
    hold: 'Hold still',
    size: 'Shot size',
    characters: 'In the picture',
    rest: 'Others',
    hands: 'Instrument hands',
    state: 'Start pose',
    frame: 'In frame',
    motion: 'Movement',
    facing: 'Facing',
    plays: 'Instrument action',
    singing: 'Singing',
    playing: 'Playing',
} as const satisfies Record<string, string>
/** The word for a field of a shot; a field the table does not know keeps its key. */
export const shotField = (key: string): string => (SHOT_FIELDS as Record<string, string>)[key] ?? key
