import {createHash, randomUUID} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {withProjectLock, lockHolder} from '../lock.ts'
import {writeJsonFile} from '../json-file.ts'
import type {Project} from '../project.ts'
import type {FilmProject} from '../film/types.ts'
import type {AskOptions} from '../llm.ts'
import type {DirectionRule, DirectionShot, DirectionView, DirectionProposal, DirectionVersion, DirectionChange, DirectionEdit} from '../../shared/direction.ts'
import {applyEdit, describeEdit, directionNotes, inScope, namesIn, written} from './edits.ts'
import {musicShots, putMusicShot, musicContext} from './music.ts'
import {filmShots, putFilmShot, filmContext} from './film.ts'
import {directionPrompt} from './prompt.ts'
export type DirectionTarget = {
    id: string
    dir: string
    kind: 'music' | 'film'
}
type Data = Project | FilmProject
type State = {
    schema: 1
    rules: DirectionRule[]
    edits?: DirectionEdit[]
    proposal?: DirectionProposal
    versions: DirectionVersion[]
    activeVersion?: string
    appliedRules?: string
    restored?: boolean
}
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')
// the rules a preview rewrites the shots for and a take accepts - a rule for the planner only (planned, #765) is planned with
// when its beats are planned again and needs no review
const reviewed = (s: State) => s.rules.filter(r => !r.planned)
const file = (t: DirectionTarget) => join(t.dir, 'direction.json')
const source = (t: DirectionTarget): Data => JSON.parse(readFileSync(join(t.dir, 'project.json'), 'utf8'))
const shots = (t: DirectionTarget, d: Data) => (t.kind === 'film' ? filmShots(d as FilmProject) : musicShots(d as Project, renderConfig(t)))
const context = (t: DirectionTarget, d: Data) => (t.kind === 'film' ? filmContext(d as FilmProject) : musicContext(d as Project))
const renderConfig = (t: DirectionTarget) => (existsSync(join(t.dir, 'config.json')) ? JSON.parse(readFileSync(join(t.dir, 'config.json'), 'utf8')) : {})
const fingerprint = (t: DirectionTarget, d: Data) => {
    const config = renderConfig(t)
    return hash({
        plan: context(t, d),
        config: {fightClips: config.fightClips ?? false, continuity: config.continuity ?? 'never', contextFrames: config.contextFrames ?? 0},
    })
}
const put = (t: DirectionTarget, d: Data, id: string, s: Record<string, unknown>) =>
    t.kind === 'film' ? putFilmShot(d as FilmProject, id, s) : putMusicShot(d as Project, id, s)
function state(t: DirectionTarget): State {
    if (!existsSync(file(t))) return {schema: 1, rules: [], versions: []}
    const s = JSON.parse(readFileSync(file(t), 'utf8')) as State
    if (s.schema !== 1 || !Array.isArray(s.rules) || !Array.isArray(s.versions)) throw Error('invalid direction.json')
    s.rules.forEach(validateRule)
    if (s.edits !== undefined && !Array.isArray(s.edits)) throw Error('invalid direction edits')
    ;(s.edits ?? []).forEach(validateEdit)
    for (const p of [...s.versions, ...(s.proposal ? [s.proposal] : [])]) {
        if (
            !p ||
            typeof p.id !== 'string' ||
            typeof p.sourceFingerprint !== 'string' ||
            typeof p.rulesFingerprint !== 'string' ||
            !Array.isArray(p.changes) ||
            !Array.isArray(p.conflicts) ||
            p.conflicts.some(c => typeof c !== 'string')
        )
            throw Error('invalid saved direction proposal/version')
        const ids = new Set<string>()
        for (const c of p.changes) {
            if (!c || typeof c.shotId !== 'string' || ids.has(c.shotId) || !c.before || !c.after) throw Error('invalid saved direction changes')
            ids.add(c.shotId)
        }
    }
    if (s.activeVersion !== undefined && !s.versions.some(v => v.id === s.activeVersion)) throw Error('invalid active direction version')
    return s
}
const save = (t: DirectionTarget, s: State) => writeJsonFile(file(t), s)
const active = new Set<string>()
async function locked<T>(t: DirectionTarget, fn: () => T | Promise<T>): Promise<T> {
    if (active.has(t.dir) || lockHolder(t.dir)) throw Error('project is being worked on by another run')
    active.add(t.dir)
    try {
        return await withProjectLock(t.dir, `direction ${t.id}`, fn)
    } finally {
        active.delete(t.dir)
    }
}
function validateRule(r: DirectionRule) {
    if (!r || typeof r.id !== 'string' || !r.id.trim() || typeof r.text !== 'string' || !r.text.trim() || !r.scope)
        throw Error('rule requires id, verbatim text and scope')
    const s = r.scope
    if (!['global', 'character', 'beat', 'scene', 'shot', 'time'].includes(s.kind)) throw Error('invalid direction scope')
    if (s.kind === 'time') {
        if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start) throw Error('invalid time range')
    } else if (s.kind !== 'global' && (typeof s.id !== 'string' || !s.id)) throw Error('scope requires id')
    if (r.characterId !== undefined && (typeof r.characterId !== 'string' || !r.characterId)) throw Error('invalid characterId')
    if (r.binding !== undefined && typeof r.binding !== 'string') throw Error('invalid binding')
    if (r.planned !== undefined && typeof r.planned !== 'boolean') throw Error('invalid planned')
    const p = r.presence
    if (p !== undefined && (!p || typeof p.in !== 'boolean' || !Array.isArray(p.characters) || p.characters.some(c => typeof c !== 'string' || !c)))
        throw Error('invalid presence')
}
function validateEdit(e: DirectionEdit) {
    if (!e || typeof e.id !== 'string' || !e.id.trim()) throw Error('edit requires id')
    validateRule({id: e.id, text: 'edit', scope: e.scope})
    if ([e.remove, e.add, e.size].filter(v => v !== undefined).length !== 1) throw Error('an edit removes a character, adds one or sets the size')
    if (e.remove !== undefined && (typeof e.remove !== 'string' || !e.remove)) throw Error('invalid character to remove')
    if (e.add !== undefined && (typeof e.add !== 'string' || !e.add)) throw Error('invalid character to add')
    // into one shot only: a beat or clips get people with --with (the beat planned again), which stages them with everyone
    if (e.add !== undefined && e.scope.kind !== 'shot') throw Error('a character is added to one shot (scope shot:ID); for beats or clips use --with')
    if (e.size !== undefined && !['wide', 'medium', 'close', 'extreme'].includes(e.size)) throw Error('invalid size: wide, medium, close or extreme')
    if (e.binding !== undefined && typeof e.binding !== 'string') throw Error('invalid binding')
}
const nameIn = (d: Data) => (id: string) => d.cast?.characters.find(c => c.id === id)?.name ?? id
const groupIds = (t: DirectionTarget, d: Data) =>
    t.kind === 'film' ? ((d as FilmProject).screenplay?.scenes ?? []).map(g => g.id) : ((d as Project).beats ?? []).map(g => g.id)
/** A shot edit is bound to the shot it was chosen for: after a new plan it waits for an explicit rebind, like a rule. */
const editBinding = (t: DirectionTarget, d: Data, e: DirectionEdit) =>
    e.scope.kind === 'shot' ? binding(t, d, {id: e.id, text: 'edit', scope: e.scope}) : undefined
type EditIssue = DirectionView['editIssues'][number]
/** The edits on a copy of the plan - in their order, after the accepted version. `issues` collects what they could not do. */
function withEdits(t: DirectionTarget, source: Data, copy: Data, s: State, issues: EditIssue[] = []) {
    const edits = s.edits ?? []
    if (!edits.length) return copy
    const nameOf = nameIn(source)
    const bound = edits.filter(e => {
        if (e.binding === undefined || e.binding === editBinding(t, source, e)) return true
        issues.push({editId: e.id, message: 'Source shot changed; explicitly rebind or remove this edit.'})
        return false
    })
    for (const shot of shots(t, copy)) {
        let data = shot.data,
            changed = false
        const named: DirectionEdit[] = [],
            added: DirectionEdit[] = []
        for (const e of bound.filter(e => inScope(e, shot))) {
            const result = applyEdit(data, e, nameOf, t.kind === 'film')
            if (result.issue) issues.push({editId: e.id, shotId: shot.id, message: result.issue})
            if (result.mentions) named.push(e)
            if (result.unwritten) added.push(e)
            if (result.data) {
                data = result.data
                changed = true
            }
        }
        // asked once all of them are out: words that named somebody only in the part of another one taken out are gone with it
        for (const e of named.filter(e => !((data.characters ?? []) as string[]).includes(e.remove!) && namesIn(data, nameOf(e.remove!))))
            issues.push({
                editId: e.id,
                shotId: shot.id,
                mentions: true,
                message: `The shot's text still names ${nameOf(e.remove!)} - a preview rewrites it.`,
            })
        // brought in, and not taken out again by a later edit: until they have a place in the shot, a preview writes it
        const people = data.people as Record<string, Record<string, unknown>> | undefined
        for (const e of added.filter(e => ((data.characters ?? []) as string[]).includes(e.add!) && (!people || !written(people[e.add!]))))
            issues.push({
                editId: e.id,
                shotId: shot.id,
                mentions: true,
                message: `${nameOf(e.add!)} is in the shot with nothing to do yet - a preview writes where they are and what they do.`,
            })
        if (changed) put(t, copy, shot.id, data)
    }
    return copy
}
/** The rules the preview gets for the words an edit left: a person taken out of a shot whose texts still name them. */
function editRules(t: DirectionTarget, d: Data, s: State): DirectionRule[] {
    const issues: EditIssue[] = []
    withEdits(t, d, overlay(t, d, {...s, edits: []}), s, issues)
    const nameOf = nameIn(d)
    const joinAnd = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''))
    // one rule a shot, however many were taken out of it: the model writes the shot once, without all of them
    const out = new Map<string, string[]>(),
        into = new Map<string, string[]>()
    for (const i of issues.filter(i => i.mentions && i.shotId)) {
        const e = (s.edits ?? []).find(e => e.id === i.editId)!
        const map = e.add ? into : out
        const name = nameOf(e.add ?? e.remove!)
        const names = map.get(i.shotId!) ?? []
        if (!names.includes(name)) map.set(i.shotId!, [...names, name])
    }
    const without = [...out].map(([shotId, names]): DirectionRule => {
        const who = joinAnd(names)
        const them = names.length > 1 ? 'them' : who
        return {
            id: `edit:${shotId}`,
            text: `${who} ${names.length > 1 ? 'are' : 'is'} no longer in this shot: write it without ${them} - nobody in it is ${names.length > 1 ? 'one of them' : who}, looks at, speaks to or touches ${them}.`,
            scope: {kind: 'shot', id: shotId},
        }
    })
    // brought in by the director (#792): already among the shot's characters, with an empty entry in people - the words are the model's
    const within = [...into].map(([shotId, names]): DirectionRule => {
        const who = joinAnd(names)
        const many = names.length > 1
        const them = many ? 'them' : who
        return {
            id: `edit-add:${shotId}`,
            text: `${who} ${many ? 'are' : 'is'} now in this shot: write ${them} into it, at the place of this shot - in people, where ${many ? 'each one is' : 'they are'} at the start (state), where in the frame (frame) and how ${many ? 'each one moves' : 'they move'} (motion), and in the action. ${many ? 'They do' : `${who} does`} not sing; keep what the others do as far as it goes.`,
            scope: {kind: 'shot', id: shotId},
        }
    })
    return [...without, ...within]
}
/** The edits as notes for the planner, per beat or scene (lib/shot-planner.ts, the film's coverage): what a new plan keeps to. */
export function directionPlanNotes(t: DirectionTarget, d: Data): Record<string, string[]> {
    if (!existsSync(file(t))) return {}
    const s = state(t)
    const notes = directionNotes(s.edits ?? [], groupIds(t, d), nameIn(d))
    // the director's own words too, for the beats or scenes they are about: a plan made again keeps to them from the start
    // (#765) - a rule on a stretch of time, or a reviewed one on a shot, stays with the preview, which rewrites the shots that are
    // there; a planned one on a shot of a music video (#767) is a note of its beat for that shot, which the planner numbers the same
    const add = (group: string, note: string) => {
        ;(notes[group] ??= []).push(note)
    }
    const nameOf = nameIn(d)
    for (const r of s.rules) {
        const text = r.text.trim()
        const about = r.characterId ? `for ${nameOf(r.characterId)}: ${text}` : text
        const sc = r.scope
        const shot = sc.kind === 'shot' && r.planned && t.kind === 'music' ? /^(.+):shot([1-9]\d*)$/.exec(sc.id) : null
        if (shot) add(shot[1]!, `shot ${shot[2]}: ${about}`)
        else if (sc.kind === 'beat' || sc.kind === 'scene') add(sc.id, about)
        else if (sc.kind === 'global') for (const group of groupIds(t, d)) add(group, about)
        else if (sc.kind === 'character') {
            const groups = t.kind === 'film' ? groupIds(t, d) : ((d as Project).beats ?? []).filter(b => b.characterIds.includes(sc.id)).map(b => b.id)
            for (const group of groups) add(group, `for ${nameOf(sc.id)}: ${text}`)
        }
    }
    return notes
}
export {describeEdit}
function matches(r: DirectionRule, s: DirectionShot) {
    if (r.characterId && !s.characters.includes(r.characterId)) return false
    const sc = r.scope
    switch (sc.kind) {
        case 'global':
            return true
        case 'character':
            return s.characters.includes(sc.id)
        case 'shot':
            return s.id === sc.id
        case 'beat':
        case 'scene':
            return s.groupId === sc.id
        case 'time':
            return s.start !== undefined && s.end !== undefined && s.start < sc.end && s.end > sc.start
    }
}
function binding(t: DirectionTarget, d: Data, r: DirectionRule): string | undefined {
    if (!['shot', 'scene', 'beat'].includes(r.scope.kind)) return undefined
    const selected = shots(t, d).filter(s => matches(r, s))
    if (!selected.length) return 'missing'
    const groupIds = new Set(selected.map(s => s.groupId))
    const groups =
        t.kind === 'film' ? (d as FilmProject).screenplay?.scenes.filter(g => groupIds.has(g.id)) : (d as Project).beats?.filter(g => groupIds.has(g.id))
    return hash({groups, shots: selected})
}
function unresolved(t: DirectionTarget, d: Data, s: State) {
    // a rule saved for a beat or scene without shots yet ('missing') holds for the shots it is planned with (#765). The shots as the
    // direct edits leave them: a rule for someone brought into a shot (#792) selects it
    const edited = shots(t, withEdits(t, d, structuredClone(d), s))
    return reviewed(s).flatMap(r =>
        r.binding !== undefined && r.binding !== 'missing' && r.binding !== binding(t, d, r)
            ? [{ruleId: r.id, message: 'Its shots were planned again: rebind it to the shots as they are now, or remove it.'}]
            : !edited.some(sh => matches(r, sh))
              ? [{ruleId: r.id, message: 'It selects no shot of the plan as it is now: rebind or remove it.'}]
              : [],
    )
}
const scopeName = (r: DirectionRule) =>
    r.scope.kind === 'global' ? 'whole project' : r.scope.kind === 'time' ? `${r.scope.start}-${r.scope.end} s` : `${r.scope.kind} ${r.scope.id}`
const shortText = (text: string) => {
    const flat = text.trim().replace(/\s+/g, ' ')
    return flat.length > 70 ? `${flat.slice(0, 69)}…` : flat
}
/** The unresolved rules one per line, by scope and the start of their words, with what is wrong (#782). */
function unresolvedLines(t: DirectionTarget, d: Data, s: State): string[] {
    return unresolved(t, d, s).map(u => {
        const r = s.rules.find(r => r.id === u.ruleId)!
        return `${scopeName(r)} "${shortText(r.text)}": ${u.message}`
    })
}
/**
 * Whether the direction waits for a review before a run can build the clips (#782), read-only: the rules that have to be rebound
 * or removed first, one per line, and whether rules are not taken yet. Undefined when the project has no direction.
 */
export function directionReview(t: DirectionTarget): {pending: boolean; unresolved: string[]} | undefined {
    if (!existsSync(file(t)) || !existsSync(join(t.dir, 'project.json'))) return undefined
    const d = source(t),
        s = state(t)
    const pending = reviewed(s).length > 0 && (s.appliedRules !== hash(reviewed(s)) || !applied(t, d, s))
    return {pending, unresolved: unresolvedLines(t, d, s)}
}
function applied(t: DirectionTarget, d: Data, s: State) {
    const v = s.versions.find(v => v.id === s.activeVersion)
    return v?.sourceFingerprint === fingerprint(t, d) ? v : undefined
}
function overlay(t: DirectionTarget, d: Data, s: State, issues?: EditIssue[]) {
    const copy = structuredClone(d)
    const changes = applied(t, d, s)?.changes ?? []
    if (!changes.length) return withEdits(t, d, copy, s, issues)
    const original = new Map(shots(t, d).map(shot => [shot.id, shot]))
    for (const c of changes) {
        const before = original.get(c.shotId)
        if (!before) throw Error('invalid saved direction shot')
        validateAfter(before.data, c.after, broughtInto(s, c.shotId))
        put(t, copy, c.shotId, c.after)
    }
    return withEdits(t, d, copy, s, issues)
}
export function readDirection(t: DirectionTarget): DirectionView {
    const d = source(t),
        s = state(t)
    const cast = d.cast
    const accepted = applied(t, d, s)
    const editIssues: EditIssue[] = []
    const planned = overlay(t, d, s, editIssues)
    return {
        rules: s.rules,
        edits: s.edits ?? [],
        editIssues,
        shots: shots(t, planned),
        characters: cast?.characters.map(c => ({id: c.id, name: c.name})) ?? [],
        groups:
            t.kind === 'film'
                ? ((d as FilmProject).screenplay?.scenes ?? []).map(g => ({id: g.id, label: g.location ?? g.id}))
                : ((d as Project).beats ?? []).map(g => ({id: g.id, label: g.summary})),
        unresolved: unresolved(t, d, s),
        proposal: s.proposal,
        versions: s.versions,
        activeVersion: accepted?.id,
        pending: reviewed(s).length > 0 && (s.appliedRules !== hash(reviewed(s)) || !accepted),
        restored: !!s.restored,
        proposalStale: !!s.proposal && (s.proposal.sourceFingerprint !== fingerprint(t, d) || s.proposal.rulesFingerprint !== hash(reviewed(s))),
    }
}
/** Saves the edits (the whole list): a shot edit is bound to its current shot unless it keeps the binding it has. */
export async function setDirectionEdits(
    t: DirectionTarget,
    input: {
        edits: DirectionEdit[]
    },
) {
    return locked(t, () => {
        if (!input || !Array.isArray(input.edits)) throw Error('expected {edits: [...]}')
        const d = source(t),
            s = state(t)
        // a person brought in whose place in the shot was taken is in the accepted plan now: undoing the edit cannot take them
        // out of it - a Take out (a remove edit) does
        const taken = applied(t, d, s)?.changes ?? []
        for (const gone of (s.edits ?? []).filter(e => e.add && !input.edits?.some(n => n.id === e.id))) {
            const shotId = (gone.scope as {id: string}).id
            const after = taken.find(c => c.shotId === shotId)?.after
            if (((after?.characters ?? []) as string[]).includes(gone.add!))
                throw Error(
                    `${nameIn(d)(gone.add!)} is in the taken plan of ${shotId}: take them out with Take out (--without), or restore an earlier plan version`,
                )
        }
        const ids = new Set<string>()
        s.edits = input.edits.map(e => {
            validateEdit(e)
            if (ids.has(e.id)) throw Error('duplicate edit id')
            ids.add(e.id)
            if (t.kind === 'film' && (e.scope.kind === 'time' || e.scope.kind === 'beat')) throw Error('film uses scene scopes, not beat/time')
            if (t.kind === 'music' && e.scope.kind === 'scene') throw Error('music uses beat scope')
            if (e.remove && !d.cast?.characters.some(c => c.id === e.remove)) throw Error(`no character ${e.remove}`)
            if (e.add && !d.cast?.characters.some(c => c.id === e.add)) throw Error(`no character ${e.add} in the cast`)
            const bound = editBinding(t, d, e)
            if (bound === 'missing') throw Error(`no shot ${(e.scope as {id: string}).id}`)
            return {...e, ...(bound !== undefined ? {binding: e.binding ?? bound} : {})}
        })
        // a proposal was made from the shots as they were
        delete s.proposal
        save(t, s)
        return readDirection(t)
    })
}
export async function setDirectionRules(
    t: DirectionTarget,
    input: {
        rules: DirectionRule[]
    },
) {
    return locked(t, () => {
        if (!input || !Array.isArray(input.rules)) throw Error('expected {rules: [...]}')
        const d = source(t),
            s = state(t)
        const ids = new Set<string>()
        s.rules = input.rules.map(r => {
            validateRule(r)
            if (ids.has(r.id)) throw Error('duplicate rule id')
            ids.add(r.id)
            if (t.kind === 'film' && (r.scope.kind === 'time' || r.scope.kind === 'beat')) throw Error('film uses scene scopes, not beat/time')
            if (t.kind === 'music' && r.scope.kind === 'scene') throw Error('music uses beat scope')
            return {...r, ...(binding(t, d, r) !== undefined ? {binding: r.binding ?? binding(t, d, r)} : {})}
        })
        if (!reviewed(s).length && applied(t, d, s)) s.appliedRules = hash(reviewed(s))
        delete s.proposal
        save(t, s)
        return readDirection(t)
    })
}
const editable = new Set(['action', 'framing', 'camera', 'view', 'hold', 'size', 'rest', 'people', 'characters', 'hands'])
/** Whoever the director brought into a shot (#792): a proposal may have them although the plan before it did not. */
const broughtInto = (s: State, shotId: string) => (s.edits ?? []).filter(e => e.add && e.scope.kind === 'shot' && e.scope.id === shotId).map(e => e.add!)
function validateAfter(before: Record<string, unknown>, after: unknown, brought: string[] = []) {
    if (!after || typeof after !== 'object' || Array.isArray(after)) throw Error('invalid shot object')
    const a = after as Record<string, unknown>
    for (const key of new Set([...Object.keys(before), ...Object.keys(a)])) {
        if (!editable.has(key) && hash(before[key] ?? null) !== hash(a[key] ?? null)) throw Error(`protected shot field: ${key}`)
        if (
            editable.has(key) &&
            !['people', 'characters'].includes(key) &&
            a[key] !== undefined &&
            (key === 'hold' ? typeof a[key] !== 'boolean' : typeof a[key] !== 'string' || !(a[key] as string).trim())
        )
            throw Error(`invalid editable field ${key}`)
    }
    if (typeof a.action !== 'string' || !a.action.trim()) throw Error('missing shot action')
    if (a.size !== undefined && !['wide', 'medium', 'close', 'extreme'].includes(a.size as string)) throw Error('invalid size')
    const original = [...new Set([...((before.characters ?? []) as string[]), ...brought])],
        visible = (a.characters ?? []) as string[]
    if (!Array.isArray(visible) || visible.some(id => typeof id !== 'string' || !original.includes(id)) || new Set(visible).size !== visible.length)
        throw Error('protected cast identities')
    if (Array.isArray(before.lines) && before.lines.length && hash(before.characters ?? []) !== hash(visible.filter(id => !brought.includes(id))))
        throw Error('protected speaking characters')
    if (a.hands !== undefined && (typeof a.hands !== 'string' || !visible.includes(a.hands))) throw Error('hands must name visible player')
    const bp = {
            ...Object.fromEntries(brought.map(id => [id, {}])),
            ...((before.people ?? {}) as Record<string, Record<string, unknown>>),
        } as Record<string, Record<string, unknown>>,
        ap = (a.people ?? {}) as Record<string, Record<string, unknown>>
    if (
        !ap ||
        typeof ap !== 'object' ||
        Array.isArray(ap) ||
        Object.keys(ap).some(id => !bp[id] || !visible.includes(id)) ||
        Object.entries(bp).some(([id, p]) => (p.singing === true || p.playing === true) && !ap[id])
    )
        throw Error('protected people identities')
    for (const id of Object.keys(ap)) {
        if (!ap[id] || typeof ap[id] !== 'object' || Array.isArray(ap[id])) throw Error('invalid person')
        for (const key of new Set([...Object.keys(bp[id]!), ...Object.keys(ap[id]!)])) {
            // Creative movement/pose fields may change; performance flags and all other structured facts stay.
            // a flag that is false says what a missing one says: "singing": false written for someone brought in is no change (#795)
            const fact = (value: unknown) => (value === false ? null : (value ?? null))
            if (!['frame', 'motion', 'state', 'facing', 'plays'].includes(key) && hash(fact(bp[id]![key])) !== hash(fact(ap[id]![key])))
                throw Error(`protected person field ${key}`)
            if (
                ['frame', 'motion', 'state', 'facing', 'plays'].includes(key) &&
                ap[id]![key] !== undefined &&
                (typeof ap[id]![key] !== 'string' || !(ap[id]![key] as string).trim())
            )
                throw Error('invalid person motion')
            if (key === 'facing' && ap[id]![key] !== undefined && !['left', 'right', 'camera', 'away'].includes(ap[id]![key] as string))
                throw Error('invalid facing: left, right, camera or away')
        }
    }
    return a
}
function localContext(t: DirectionTarget, d: Data, selected: DirectionShot[]) {
    const groups = new Set(selected.map(s => s.groupId)),
        ids = new Set(selected.flatMap(s => s.characters))
    if (t.kind === 'film') {
        const f = d as FilmProject
        return {
            scenes: f.screenplay?.scenes.filter(g => groups.has(g.id)),
            coverage: f.coverage?.filter(g => groups.has(g.sceneId)).map(({shots, ...g}) => g),
            cast: f.cast?.characters.filter(c => ids.has(c.id)),
            look: f.lookBrief,
        }
    }
    const m = d as Project
    return {
        beats: m.beats?.filter(g => groups.has(g.id)),
        blocking: Object.fromEntries(Object.entries(m.blocking ?? {}).filter(([id]) => groups.has(id))),
        cast: m.cast?.characters.filter(c => ids.has(c.id)),
        look: m.lookBrief,
    }
}
export type DirectionAsk = (options: AskOptions) => Promise<unknown>
export async function previewDirection(t: DirectionTarget, ask?: DirectionAsk) {
    return locked(t, async () => {
        const d = source(t),
            s = state(t),
            initialFingerprint = fingerprint(t, d)
        if (!shots(t, d).length) throw Error('plan shots first')
        const open = unresolvedLines(t, d, s)
        if (open.length)
            throw Error(
                `unresolved rules need explicit rebinding (--edit=ID --text=TEXT --scope=SCOPE, or --remove=ID; on the Direction page: Review current binding or Remove):\n${open.map(line => `  - ${line}`).join('\n')}`,
            )
        const current = shots(t, overlay(t, d, s))
        // the rules, and for a person an edit took out of a shot whose words still name them, a rule to write it without them
        const rules = [...reviewed(s), ...editRules(t, d, s)]
        const selected = current.filter(sh => rules.some(r => matches(r, sh)))
        if (!selected.length) throw Error('no selected shots; restore a version to undo edits')
        const run = ask ?? (await import('../llm.ts')).askJson
        let failure = ''
        let proposal: DirectionProposal | undefined
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const raw = await run(
                    directionPrompt({
                        rules,
                        selected: selected.map(shot => ({...shot, ruleIds: rules.filter(rule => matches(rule, shot)).map(rule => rule.id)})),
                        context: localContext(t, d, selected),
                        neighbors: current.filter(
                            (sh, i) => selected.some(s => s.id === current[i - 1]?.id || s.id === current[i + 1]?.id) && !selected.some(s => s.id === sh.id),
                        ),
                        previousError: failure,
                    }),
                )
                if (!raw || typeof raw !== 'object') throw Error('invalid model response')
                const r = raw as {
                    changes: unknown[]
                    conflicts: unknown[]
                }
                if (
                    !Array.isArray(r.changes) ||
                    !Array.isArray(r.conflicts) ||
                    r.conflicts.some(c => typeof c !== 'string') ||
                    (r.changes.length === 0 && r.conflicts.length === 0) ||
                    r.changes.length > selected.length
                )
                    throw Error('response must contain chosen selected shots and conflicts')
                const seen = new Set<string>()
                const changes: DirectionChange[] = r.changes.map(entry => {
                    const c = entry as {
                        shotId: string
                        after: unknown
                    }
                    const sh = selected.find(sh => sh.id === c?.shotId)
                    if (!sh || seen.has(c.shotId)) throw Error('unknown or duplicate shot')
                    seen.add(c.shotId)
                    return {shotId: c.shotId, before: sh.data, after: validateAfter(sh.data, c.after)}
                })
                // whoever the director brought into a shot (#792) stays in it, with a place: the model may leave others out, not them
                for (const sh of selected) {
                    const people = (sh.data.people ?? {}) as Record<string, Record<string, unknown>>
                    for (const e of (s.edits ?? []).filter(
                        e => e.add && e.scope.kind === 'shot' && e.scope.id === sh.id && people[e.add] && !written(people[e.add]),
                    )) {
                        const after = changes.find(c => c.shotId === sh.id)?.after
                        const placed = ((after?.people ?? {}) as Record<string, Record<string, unknown>>)[e.add!]
                        if (!after || !((after.characters ?? []) as string[]).includes(e.add!) || !written(placed))
                            throw Error(
                                `${nameIn(d)(e.add!)} was brought into ${sh.id}: keep them in characters and give them state, frame and motion in people`,
                            )
                    }
                }
                proposal = {
                    id: randomUUID(),
                    sourceFingerprint: initialFingerprint,
                    rulesFingerprint: hash(reviewed(s)),
                    changes,
                    conflicts: r.conflicts as string[],
                }
                break
            } catch (e) {
                failure = e instanceof Error ? e.message : String(e)
            }
        }
        if (!proposal) throw Error(`direction response rejected after 2 attempts: ${failure}`)
        if (fingerprint(t, source(t)) !== initialFingerprint) throw Error('stale plan changed during proposal')
        s.proposal = proposal
        save(t, s)
        return readDirection(t)
    })
}
/**
 * Takes the proposal. A proposal with conflicts is taken only when asked to anyway (despiteConflicts): the model reports both rules
 * that contradict each other and mere notes on continuity ("the cut to shot 4 changes the perspective"), and only the director can
 * tell which one it is - the proposal itself is checked like any other.
 */
export async function takeDirection(t: DirectionTarget, {despiteConflicts = false}: {despiteConflicts?: boolean} = {}) {
    return locked(t, () => {
        const d = source(t),
            s = state(t),
            p = s.proposal
        if (!p) throw Error('no proposal')
        if (p.sourceFingerprint !== fingerprint(t, d) || p.rulesFingerprint !== hash(reviewed(s))) throw Error('stale proposal')
        if (p.conflicts.length && !despiteConflicts)
            throw Error('the proposal reports conflicts: resolve them and preview again, or take it anyway (--despite-conflicts)')
        const all = shots(t, d)
        for (const c of p.changes) {
            const before = all.find(sh => sh.id === c.shotId)
            if (!before) throw Error('unknown shot')
            validateAfter(before.data, c.after, broughtInto(s, c.shotId))
        }
        // Keep a baseline and complete overlays so removing a rule never implicitly undoes prior accepted action.
        if (!s.versions.some(v => v.sourceFingerprint === p.sourceFingerprint && v.id.startsWith('baseline-')))
            s.versions.push({
                id: `baseline-${randomUUID()}`,
                sourceFingerprint: p.sourceFingerprint,
                rulesFingerprint: p.rulesFingerprint,
                changes: [],
                conflicts: [],
                createdAt: new Date().toISOString(),
            })
        const merged = new Map((applied(t, d, s)?.changes ?? []).map(c => [c.shotId, c]))
        for (const c of p.changes) merged.set(c.shotId, c)
        s.versions.push({...p, changes: [...merged.values()], createdAt: new Date().toISOString()})
        s.activeVersion = p.id
        s.appliedRules = hash(reviewed(s))
        s.restored = false
        delete s.proposal
        save(t, s)
        return readDirection(t)
    })
}
export async function dropDirection(t: DirectionTarget) {
    return locked(t, () => {
        const s = state(t)
        delete s.proposal
        save(t, s)
        return readDirection(t)
    })
}
export async function restoreDirection(t: DirectionTarget, id: string) {
    return locked(t, () => {
        const s = state(t),
            v = s.versions.find(v => v.id === id)
        if (!v) throw Error('unknown version')
        if (v.sourceFingerprint !== fingerprint(t, source(t))) throw Error('stale version belongs to a different source plan')
        overlay(t, source(t), {...s, activeVersion: id})
        s.activeVersion = id
        s.appliedRules = hash(reviewed(s))
        s.restored = true
        delete s.proposal
        save(t, s)
        return readDirection(t)
    })
}
/** Accepted plan overlay only. Never save this derived data back into project.json. */
export function applyDirectionOverlay<T extends Data>(
    t: DirectionTarget,
    d: T,
    options: {
        allowPending?: boolean
    } = {},
): T {
    const s = state(t)
    const pending = reviewed(s).length > 0 && (s.appliedRules !== hash(reviewed(s)) || !applied(t, d, s))
    if (pending && !options.allowPending) {
        const open = unresolvedLines(t, d, s)
        throw Error(
            `Direction needs review: bun run direction ${t.id}${t.kind === 'film' ? ' --film' : ''} --preview, then --take - or the Direction page of the workspace.` +
                (open.length
                    ? ` First rebind or remove ${open.length === 1 ? 'this rule' : `these ${open.length} rules`}:\n${open.map(line => `  - ${line}`).join('\n')}`
                    : ''),
        )
    }
    return overlay(t, d, s) as T
}
