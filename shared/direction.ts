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
    }[]
    proposal?: DirectionProposal
    versions: DirectionVersion[]
    activeVersion?: string
    pending: boolean
    restored: boolean
    proposalStale?: boolean
}
