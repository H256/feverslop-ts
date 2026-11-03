import type {CastMember, CastView, ElementKind} from '../../../../shared/workspace'

/** One member of the cast by hand: its name and texts. What a film's role has differs from a music video's. */
export type DraftMember = Partial<CastMember> & {name: string}
/** The cast as changed on the page, not saved yet: copies, so the reading it came from stays as it was. */
export type CastDraft = {characters: DraftMember[], locations: DraftMember[]}

export const castDraft = (cast: CastView): CastDraft => ({characters: cast.characters.map(c => ({...c})), locations: cast.locations.map(l => ({...l}))})
/** A new member: a character comes with a role to fill in. */
export const newMember = (kind: ElementKind): DraftMember => kind === 'character' ? {name: '', role: ''} : {name: ''}
