import {existsSync, readFileSync, statSync} from 'node:fs'
import {writeJsonFile} from '../json-file.ts'
import {isAbsolute, join, relative, resolve} from 'node:path'
import {assetPaths} from '../asset-import.ts'
import type {ClipRequest} from '../compose.ts'
import {withProjectLock} from '../lock.ts'
import {dropBeatPlans, type Project, type Singing} from '../project.ts'
import {normalizeParts, singersOfParts, type SingingPart} from '../singing-parts.ts'
import {readClipRequests} from '../render-state.ts'
import type {EditorTarget} from './project.ts'
import type {SingingView, SingingChange, SingingResult} from '../../shared/workspace.ts'
export type {SingingLine, SingingCharacter, SingingView, SingingChange, SingingResult} from '../../shared/workspace.ts'

// Who sings which line, as the workspace shows and changes it. The pipeline asks the language model once (step `singing`);
// what is set here by hand replaces that answer in project.json, and the beats it touches lose their shot plan - the next
// plan run plans just those again, on the floor plans they have (index.ts: "Planning again"). Nothing else is redone: the
// story beats and the other beats' shots stay as they are.

// a line is sung by `singers` as a whole, or with `parts` by each part's singers from its word on (singers is then ignored)

type Request = Pick<ClipRequest, 'id' | 'beatId' | 'vocals'> & {assets?: {pictures: {kind: string; id: string}[]}}
/** The clips a character is in: becoming a singer, or no longer being one, changes what all of them say (silent singers keep their mouth closed). */
const clipsWith = (requests: Request[], id: string) => requests.filter(c => c.assets?.pictures.some(p => p.kind === 'character' && p.id === id)).map(c => c.id)

const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined)

/** Per sung line, the beats and clips it is sung in - from the clip requests, as the plan has them now. */
function whereSung(requests: Request[]) {
    const found = new Map<number, {beats: Set<string>; clips: Set<string>}>()
    for (const clip of requests)
        for (const v of clip.vocals ?? []) {
            const at = found.get(v.line) ?? {beats: new Set(), clips: new Set()}
            at.beats.add(clip.beatId)
            at.clips.add(clip.id)
            found.set(v.line, at)
        }
    return found
}

export function singingView(dir: string, data: Project, requests: Request[]): SingingView | undefined {
    const singing = data.singing
    if (!singing) return undefined
    const characters = data.cast?.characters ?? []
    const timing = new Map((data.lyricsTiming?.lines ?? []).map(l => [l.line, l]))
    const sung = whereSung(requests)
    const beats = data.beats ?? []
    const planned = (id: string) => data.shotMoments?.[id] !== undefined
    const versioned = (file: string) => (existsSync(join(dir, file)) ? {file, v: Math.round(statSync(join(dir, file)).mtimeMs)} : undefined)
    return {
        singers: singing.singers,
        lines: singing.lines.map(l => ({
            line: l.line,
            text: l.text,
            singers: l.singers,
            ...(l.parts ? {parts: l.parts} : {}),
            words: (timing.get(l.line)?.words ?? []).map(w => ({text: w.text, start: w.start, end: w.end})),
            estimated: (timing.get(l.line)?.confidence ?? 1) < 0.5,
            section: timing.get(l.line)?.section,
            start: timing.get(l.line)?.start,
            end: timing.get(l.line)?.end,
            beats: [...(sung.get(l.line)?.beats ?? [])],
            clips: [...(sung.get(l.line)?.clips ?? [])],
        })),
        characters: characters.map(c => ({
            id: c.id,
            name: c.name,
            role: c.role,
            picture: versioned(assetPaths('character', c.id).picture),
            beats: beats.filter(b => b.characterIds.includes(c.id)).map(b => b.id),
            clips: clipsWith(requests, c.id),
        })),
        beats: beats.map(b => ({
            id: b.id,
            characterIds: b.characterIds,
            planned: planned(b.id),
            clips: requests.filter(c => c.beatId === b.id).map(c => c.id),
        })),
        unplanned: data.shotMoments ? beats.filter(b => !planned(b.id)).map(b => b.id) : [],
        audio: inside(dir, data.stems?.vocals) ?? inside(dir, readJson<{song?: string}>(join(dir, 'output', 'timeline.json'))?.song),
    }
}

/** A sound file of the project, relative to it - only one inside it: the page is served nothing else. */
function inside(dir: string, file: string | undefined) {
    if (!file) return undefined
    const path = relative(dir, resolve(dir, file.replace(/\\/g, '/'))).replace(/\\/g, '/')
    if (path.startsWith('..') || isAbsolute(path) || !existsSync(join(dir, path))) return undefined
    return {file: path, v: Math.round(statSync(join(dir, path)).mtimeMs)}
}

/**
 * The change put into the project data, in place: the singers per line, the singers of the song (the ones before in their
 * order, the new ones after them), and for every beat a changed line is sung in, the shot plan dropped. A singer who is not
 * among the beat's characters is added to them, and the beat's blocking goes too - it places only the people it was made for,
 * so the shot planning stages that beat itself. Throws on a line or a character that is not there.
 */
export function applySinging(data: Project, change: SingingChange, requests: Request[]): SingingResult {
    const singing = data.singing
    if (!singing) throw new Error('nobody sings in this project - "singers" in config.json is empty')
    const characters = data.cast?.characters ?? []
    if (!Array.isArray(change?.lines)) throw new Error('no lines')
    const wordsOf = (line: number) => data.lyricsTiming?.lines.find(l => l.line === line)?.words.length ?? 0
    const wanted = new Map<number, {singers: string[]; parts?: SingingPart[]}>()
    for (const entry of change.lines) {
        if (!singing.lines.some(l => l.line === entry.line)) throw new Error(`no sung line ${entry.line}`)
        if (entry.parts !== undefined && !Array.isArray(entry.parts)) throw new Error(`line ${entry.line + 1}: parts must be a list`)
        if (entry.parts?.some(p => !Number.isInteger(p?.from) || !Array.isArray(p.singers) || !p.singers.length))
            throw new Error(`line ${entry.line + 1}: every part needs a word and a singer`)
        if (entry.parts?.length && !wordsOf(entry.line)) throw new Error(`line ${entry.line + 1} has no word times - its singer cannot change within it`)
        const parts = normalizeParts(entry.parts, wordsOf(entry.line))
        // parts that come to one (the split taken back, or all parts by the same singers): the line is sung by theirs
        const singers = entry.parts?.length ? singersOfParts(parts ?? entry.parts) : [...new Set(Array.isArray(entry.singers) ? entry.singers : [])]
        if (!singers.length) throw new Error(`line ${entry.line + 1} needs a singer`)
        const unknown = singers.filter(id => !characters.some(c => c.id === id))
        if (unknown.length) throw new Error(`not in the cast: ${unknown.join(', ')}`)
        wanted.set(entry.line, {singers, ...(parts ? {parts} : {})})
    }
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id))
    const sameParts = (a: SingingPart[] | undefined, b: SingingPart[] | undefined) =>
        (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((p, k) => p.from === b![k]!.from && same(p.singers, b![k]!.singers))
    const changed = singing.lines
        .filter(l => wanted.has(l.line) && (!same(l.singers, wanted.get(l.line)!.singers) || !sameParts(l.parts, wanted.get(l.line)!.parts)))
        .map(l => l.line)
    const result: SingingResult = {changed, replanned: [], added: [], newSingers: [], formerSingers: [], staleClips: []}
    if (!changed.length) return result

    const lines: Singing['lines'] = singing.lines.map(l => {
        if (!changed.includes(l.line)) return l
        const {parts: _, ...rest} = l
        return {...rest, ...wanted.get(l.line)!}
    })
    const used = new Set(lines.flatMap(l => l.singers))
    data.singing = {singers: [...singing.singers.filter(id => used.has(id)), ...[...used].filter(id => !singing.singers.includes(id))], lines}
    result.newSingers = data.singing.singers.filter(id => !singing.singers.includes(id))
    result.formerSingers = singing.singers.filter(id => !used.has(id))

    const sung = whereSung(requests)
    const beats = new Set(changed.flatMap(line => [...(sung.get(line)?.beats ?? [])]))
    for (const beatId of beats) {
        const beat = data.beats?.find(b => b.id === beatId)
        if (!beat) continue
        const singersHere = new Set(changed.filter(line => sung.get(line)?.beats.has(beatId)).flatMap(line => wanted.get(line)!.singers))
        const missing = [...singersHere].filter(id => !beat.characterIds.includes(id))
        if (missing.length) {
            beat.characterIds = [...beat.characterIds, ...missing]
            result.added.push(...missing.map(character => ({beat: beatId, character})))
            if (data.blocking?.[beatId]) delete data.blocking[beatId]
        }
        // a kept answer of a stopped run is asked differently now anyway: it goes too, so that nothing old comes back
        result.replanned.push(...dropBeatPlans(data, [beatId]))
    }
    const changedSingers = [...result.newSingers, ...result.formerSingers]
    const stale = new Set([...requests.filter(c => beats.has(c.beatId)).map(c => c.id), ...changedSingers.flatMap(id => clipsWith(requests, id))])
    result.staleClips = requests.map(c => c.id).filter(id => stale.has(id))
    return result
}

export async function readSinging(target: EditorTarget): Promise<SingingView | undefined> {
    const data = readJson<Project>(join(target.dir, 'project.json')) ?? {}
    return singingView(target.dir, data, await readClipRequests<ClipRequest>(target.dir))
}

export async function writeSinging(target: EditorTarget, change: SingingChange): Promise<SingingResult> {
    if (target.kind !== 'music') throw new Error('singers are for music videos')
    const requests = await readClipRequests<ClipRequest>(target.dir)
    return withProjectLock(target.dir, target.id, () => {
        const file = join(target.dir, 'project.json')
        const data = readJson<Project>(file)
        if (!data) throw new Error('no project.json yet - run the plan first')
        const result = applySinging(data, change, requests)
        if (!result.changed.length) return result
        // next to it first, as the pipeline writes it: a crash mid-write never leaves half a project.json
        writeJsonFile(file, data)
        return result
    })
}
