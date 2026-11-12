import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {copyKey} from '../../casting.ts'
import {withProjectLock} from '../../lock.ts'
import {builtOn, type Project} from '../../project.ts'
import {screenplayToText} from '../../film/fountain.ts'
import type {FilmProject} from '../../film/types.ts'
import {
    adaptInput,
    adaptProblems,
    adaptRefusal,
    castWith,
    checkRoleChange,
    droppedByProposal,
    outlineWith,
    readAdaptAnswer,
    type RoleChange,
    type ScreenplayProposal,
    screenplayFingerprint,
} from '../../film/adapt.ts'
import {adaptScreenplayPrompt} from '../../film/prompts.ts'
import type {AskOptions} from '../../llm.ts'
import type {EditorKind, EditorTarget} from '../project.ts'
import type {BookView} from '../../../shared/workspace.ts'
import {readJson, type Data, dataOf, save, planStateOf, drop, remake} from './base.ts'

// The preproduction in the workspace (#526): the book - a music video's story, a film's screenplay - and both told anew for the cast. See ../preproduction.ts.

////////// THE BOOK - the story of a music video, the screenplay of a film

export function bookView(kind: EditorKind, data: Data): BookView {
    const state = planStateOf(kind, data)
    if (kind === 'film') {
        const screenplay = (data as FilmProject).screenplay
        return {text: screenplay && screenplayToText(screenplay), editable: false, builtOn: [], keptByCast: droppedByProposal(data as FilmProject), ...state}
    }
    const story = (data as Project).story
    return {text: story, editable: story !== undefined, builtOn: builtOn(['story'], data as Project), keptByCast: droppedKeepingCast(data as Project), ...state}
}

export function readBook(target: EditorTarget): BookView {
    const data = dataOf(target)
    const view = bookView(target.kind, data)
    if (target.kind === 'music') return {...view, proposal: storyProposal(target.dir, (data as Project).story)}
    const proposal = screenplayProposal(target.dir, data as FilmProject)
    if (!proposal) return view
    const cast = (data as FilmProject).cast!
    return {
        ...view,
        proposal: screenplayToText(proposal.screenplay),
        proposalCast: {added: proposal.added.map(c => c.name), removed: proposal.removed.map(id => cast.characters.find(c => c.id === id)?.name ?? id)},
    }
}

/** A music video's story as written on the page, in place: every step built on the old one goes. */
export function applyStory(data: Project, text: unknown): {changed: boolean; dropped: string[]} {
    if (data.story === undefined) throw new Error('no story yet - plan up to the story first')
    if (typeof text !== 'string' || !text.trim()) throw new Error('the story is empty')
    const story = text.replace(/\r\n/g, '\n').trim()
    if (story === data.story.trim()) return {changed: false, dropped: []}
    const dropped = builtOn(['story'], data)
    data.story = story
    drop(data, dropped)
    return {changed: true, dropped}
}

export async function writeStory(target: EditorTarget, text: unknown): Promise<{changed: boolean; dropped: string[]}> {
    if (target.kind !== 'music') throw new Error("a film's screenplay is changed in its script (input/) or in project.json")
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Project>(join(target.dir, 'project.json'))
        if (!data) throw new Error('no project.json yet - plan up to the story first')
        const result = applyStory(data, text)
        if (result.changed) save(target, data)
        return result
    })
}

////////// THE STORY AFTER THE CAST - a music video's story told with the cast as it is now (#542)

// a story written anew for the cast by the language model (bun run story --adapt, tools/story.ts) waits here until it is taken or dropped
export const STORY_PROPOSAL = join('output', 'story-proposal.json')
export type StoryProposal = {story: string; for: string} // for: the story it was written from - another one now: it is gone
export const storyFingerprint = (story: string) => Bun.hash(story.trim()).toString(16)

/** The proposal for this story, if there is one written from it. */
export function storyProposal(dir: string, story: string | undefined): string | undefined {
    const proposal = readJson<StoryProposal>(join(dir, STORY_PROPOSAL))
    return proposal && story !== undefined && proposal.for === storyFingerprint(story) ? proposal.story : undefined
}

/** The steps a story told anew for the same cast drops: the summary and what is planned from the beats on - the cast, who sings and the looks stay. */
export const droppedKeepingCast = (data: Project) =>
    ['summary', 'beats', ...builtOn(['beats'], data)].filter(step => (data as Record<string, unknown>)[step] !== undefined)

/** A name in the story replaced by another, as a whole word: the full name, then each of its words that changed ("Vey" by "Rook"). */
export function renameInStory(story: string, renamed: {from: string; to: string}[]): string {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const replace = (text: string, from: string, to: string) =>
        from && from !== to ? text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from)}(?![\\p{L}\\p{N}])`, 'gu'), to) : text
    let result = story
    for (const {from, to} of renamed) {
        result = replace(result, from, to)
        const was = from.split(/\s+/),
            now = to.split(/\s+/)
        if (was.length === now.length)
            was.forEach((word, i) => {
                result = replace(result, word, now[i]!)
            })
    }
    return result
}

/** A music video's story told anew for the cast it has: the text set, the summary and the plan from the beats on gone. */
export function applyStoryKeepingCast(data: Project, text: unknown): {changed: boolean; dropped: string[]} {
    if (data.story === undefined || !data.cast) throw new Error('no story and cast yet')
    if (typeof text !== 'string' || !text.trim()) throw new Error('the story is empty')
    const story = text.replace(/\r\n/g, '\n').trim()
    if (story === data.story.trim()) return {changed: false, dropped: []}
    const dropped = droppedKeepingCast(data)
    data.story = story
    drop(data, dropped)
    return {changed: true, dropped}
}

/** The story with the cast as it is now: by a proposal of the language model (taken here), or by the names that changed. A film: its screenplay told anew for a role added or taken out. */
export async function writeStoryForCast(
    target: EditorTarget,
    how: {proposal?: boolean; renamed?: {from: string; to: string}[]},
): Promise<{changed: boolean; dropped: string[]; remade?: string[]; added?: string[]; removed?: string[]}> {
    if (target.kind === 'film') {
        if (!how.proposal) throw new Error("a film's names are changed on the Casting page (bun run cast --film), its roles with a screenplay told anew")
        return takeScreenplayProposal(target)
    }
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<Project>(join(target.dir, 'project.json'))
        if (!data?.story) throw new Error('no story yet')
        const text = how.proposal ? storyProposal(target.dir, data.story) : renameInStory(data.story, how.renamed ?? [])
        if (text === undefined) throw new Error('no proposal for this story - have it written again')
        const result = applyStoryKeepingCast(data, text)
        if (result.changed) save(target, data)
        rmSync(join(target.dir, STORY_PROPOSAL), {force: true})
        return result
    })
}

export const dropStoryProposal = (target: EditorTarget) =>
    rmSync(join(target.dir, target.kind === 'film' ? SCREENPLAY_PROPOSAL : STORY_PROPOSAL), {force: true})

////////// A FILM'S ROLE ADDED OR TAKEN OUT - its screenplay told anew for the changed cast, where the pipeline wrote it (#589, lib/film/adapt.ts)

export const SCREENPLAY_PROPOSAL = join('output', 'screenplay-proposal.json')

/** The proposal for this screenplay and cast, if there is one written from them. */
export function screenplayProposal(dir: string, data: FilmProject): ScreenplayProposal | undefined {
    const proposal = readJson<ScreenplayProposal>(join(dir, SCREENPLAY_PROPOSAL))
    return proposal && data.screenplay && data.cast && proposal.for === screenplayFingerprint(data) ? proposal : undefined
}

/**
 * The screenplay told anew by the language model for the role change: asked again once with what was wrong, then kept as a proposal
 * next to the screenplay - nothing of the film changes. `ask` gives the language model's JSON answer (askJson, configured by the caller).
 */
export async function writeScreenplayProposal(
    target: EditorTarget,
    change: RoleChange,
    ask: (options: AskOptions) => Promise<unknown>,
    tell: (problems: string[]) => void = () => {},
): Promise<ScreenplayProposal> {
    if (target.kind !== 'film') throw new Error("a music video's story is told anew with bun run story --adapt")
    const data = dataOf(target) as FilmProject
    const refused = adaptRefusal(data)
    if (refused) throw new Error(refused)
    const wrong = checkRoleChange(data.cast!, change)
    if (wrong) throw new Error(wrong)
    const input = adaptInput(data, change)
    const meta = {title: data.screenplay!.title, language: data.screenplay!.language}
    let problems: string[] = []
    let answer: ReturnType<typeof readAdaptAnswer> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            answer = readAdaptAnswer(await ask(adaptScreenplayPrompt(input.screenplay, input.brief, input.cast, problems)), meta, change.add)
            problems = adaptProblems(data.screenplay!, answer.screenplay, data.cast!, {added: change.add, removed: change.remove})
        } catch (e) {
            problems = [e instanceof Error ? e.message : String(e)]
        }
        if (!problems.length) break
        tell(problems)
    }
    if (problems.length || !answer) throw new Error(`the screenplay told anew is not usable:\n${problems.map(p => `  ${p}`).join('\n')}\nrun it again`)
    const proposal: ScreenplayProposal = {screenplay: answer.screenplay, added: answer.characters, removed: change.remove, for: screenplayFingerprint(data)}
    const out = join(target.dir, SCREENPLAY_PROPOSAL)
    mkdirSync(dirname(out), {recursive: true})
    writeFileSync(out, JSON.stringify(proposal, null, 2) + '\n')
    return proposal
}

/**
 * The proposal put into the film's data, in place: the new screenplay, the cast without who went and with who came (who stays keeps
 * the id, and with it the looks - the looks of the new ones are written by the next run), the idea's outline with the same cast, and
 * what is read from the script gone. The look of the whole film and the places stay.
 */
export function applyScreenplayProposal(
    data: FilmProject,
    proposal: ScreenplayProposal,
): {changed: boolean; dropped: string[]; remade: string[]; added: string[]; removed: string[]} {
    if (!data.cast || !data.screenplay) throw new Error('no screenplay and cast yet')
    const removedCharacters = data.cast.characters.filter(c => proposal.removed.includes(c.id))
    const {cast, added} = castWith(data.cast, proposal)
    const dropped = droppedByProposal(data)
    data.screenplay = proposal.screenplay
    data.cast = cast
    if (data.outline) data.outline = outlineWith(data.outline, removedCharacters, proposal.added)
    // the idea still tells of the cast before: the script notes read the script against it knowing what changed
    data.roleChanges = [...(data.roleChanges ?? []), {added: proposal.added.map(({name, role}) => ({name, role})), removed: removedCharacters.map(c => c.name)}]
    drop(data, dropped)
    // the looks: everyone who stays keeps theirs (kept by hand), who went is out, who came is asked for by the next run
    const looks = (['characterLooks', 'characterDescriptions'] as const).filter(step => data[step] !== undefined)
    for (const step of looks) remake(data, step, proposal.removed)
    for (const id of proposal.removed) delete data.castingCopies?.[copyKey('character', id)]
    if (data.castingCopies && !Object.keys(data.castingCopies).length) delete data.castingCopies
    return {changed: true, dropped, remade: added.length ? looks.map(step => `${step}: ${added.join(', ')}`) : [], added, removed: proposal.removed}
}

/** The proposal waiting for this screenplay taken: written into project.json, the proposal gone. */
export async function takeScreenplayProposal(target: EditorTarget) {
    return withProjectLock(target.dir, target.id, () => {
        const data = readJson<FilmProject>(join(target.dir, 'project.json'))
        if (!data) throw new Error('no project.json yet')
        const refused = adaptRefusal(data)
        if (refused) throw new Error(refused)
        const proposal = screenplayProposal(target.dir, data)
        if (!proposal) throw new Error('no proposal for this screenplay - have it written again')
        const result = applyScreenplayProposal(data, proposal)
        save(target, data)
        rmSync(join(target.dir, SCREENPLAY_PROPOSAL), {force: true})
        return result
    })
}
