import {existsSync, readFileSync, renameSync, statSync, writeFileSync} from "node:fs";
import {isAbsolute, join, relative, resolve} from "node:path";
import {assetPaths} from "../asset-import.ts";
import type {ClipRequest} from "../compose.ts";
import {withProjectLock} from "../lock.ts";
import type {Project, Singing} from "../project.ts";
import {readClipRequests} from "../render-state.ts";
import type {EditorTarget} from "./project.ts";

// Who sings which line, as the workspace shows and changes it. The pipeline asks the language model once (step `singing`);
// what is set here by hand replaces that answer in project.json, and the beats it touches lose their shot plan - the next
// plan run plans just those again, on the floor plans they have (index.ts: "Planning again"). Nothing else is redone: the
// story beats and the other beats' shots stay as they are.

export type SingingLine = {
    line: number,
    text: string,
    section?: string,
    start?: number,             // seconds in the song
    end?: number,
    singers: string[],
    beats: string[],            // the beats of the clips it is sung in
    clips: string[],
}
export type SingingCharacter = { id: string, name: string, role?: string, picture?: { file: string, v: number }, beats: string[], clips: string[] }
export type SingingView = {
    singers: string[],          // the singers of the song, the lead first
    lines: SingingLine[],
    characters: SingingCharacter[],
    beats: { id: string, characterIds: string[], planned: boolean, clips: string[] }[],
    unplanned: string[],        // beats without a shot plan: the next plan run plans them
    audio?: { file: string, v: number },    // what to listen to a line in: the vocals stem, else the song
}
export type SingingChange = { lines: { line: number, singers: string[] }[] }
export type SingingResult = {
    changed: number[],          // the lines that changed
    replanned: string[],        // the beats that lost their shot plan
    added: { beat: string, character: string }[],   // singers who were not in the beat and are now
    newSingers: string[],       // sing now and did not before: every clip they are in changes
    formerSingers: string[],    // sang before and no longer do: the same
    staleClips: string[],
}

type Request = Pick<ClipRequest, 'id' | 'beatId' | 'vocals'> & { assets?: { pictures: { kind: string, id: string }[] } }
/** The clips a character is in: becoming a singer, or no longer being one, changes what all of them say (silent singers keep their mouth closed). */
const clipsWith = (requests: Request[], id: string) => requests.filter(c => c.assets?.pictures.some(p => p.kind === 'character' && p.id === id)).map(c => c.id)

const readJson = <T>(file: string): T | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined

/** Per sung line, the beats and clips it is sung in - from the clip requests, as the plan has them now. */
function whereSung(requests: Request[]) {
    const found = new Map<number, { beats: Set<string>, clips: Set<string> }>()
    for (const clip of requests) for (const v of clip.vocals ?? []) {
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
    const versioned = (file: string) => existsSync(join(dir, file)) ? {file, v: Math.round(statSync(join(dir, file)).mtimeMs)} : undefined
    return {
        singers: singing.singers,
        lines: singing.lines.map(l => ({
            line: l.line, text: l.text, singers: l.singers,
            section: timing.get(l.line)?.section, start: timing.get(l.line)?.start, end: timing.get(l.line)?.end,
            beats: [...sung.get(l.line)?.beats ?? []], clips: [...sung.get(l.line)?.clips ?? []],
        })),
        characters: characters.map(c => ({
            id: c.id, name: c.name, role: c.role, picture: versioned(assetPaths('character', c.id).picture),
            beats: beats.filter(b => b.characterIds.includes(c.id)).map(b => b.id),
            clips: clipsWith(requests, c.id),
        })),
        beats: beats.map(b => ({id: b.id, characterIds: b.characterIds, planned: planned(b.id), clips: requests.filter(c => c.beatId === b.id).map(c => c.id)})),
        unplanned: data.shotMoments ? beats.filter(b => !planned(b.id)).map(b => b.id) : [],
        audio: inside(dir, data.stems?.vocals) ?? inside(dir, readJson<{ song?: string }>(join(dir, 'output', 'timeline.json'))?.song),
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
    const wanted = new Map<number, string[]>()
    for (const entry of change.lines) {
        if (!singing.lines.some(l => l.line === entry.line)) throw new Error(`no sung line ${entry.line}`)
        if (!Array.isArray(entry.singers) || !entry.singers.length) throw new Error(`line ${entry.line + 1} needs a singer`)
        const unknown = entry.singers.filter(id => !characters.some(c => c.id === id))
        if (unknown.length) throw new Error(`not in the cast: ${unknown.join(', ')}`)
        wanted.set(entry.line, [...new Set(entry.singers)])
    }
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id))
    const changed = singing.lines.filter(l => wanted.has(l.line) && !same(l.singers, wanted.get(l.line)!)).map(l => l.line)
    const result: SingingResult = {changed, replanned: [], added: [], newSingers: [], formerSingers: [], staleClips: []}
    if (!changed.length) return result

    const lines: Singing['lines'] = singing.lines.map(l => changed.includes(l.line) ? {...l, singers: wanted.get(l.line)!} : l)
    const used = new Set(lines.flatMap(l => l.singers))
    data.singing = {singers: [...singing.singers.filter(id => used.has(id)), ...[...used].filter(id => !singing.singers.includes(id))], lines}
    result.newSingers = data.singing.singers.filter(id => !singing.singers.includes(id))
    result.formerSingers = singing.singers.filter(id => !used.has(id))

    const sung = whereSung(requests)
    const beats = new Set(changed.flatMap(line => [...sung.get(line)?.beats ?? []]))
    for (const beatId of beats) {
        const beat = data.beats?.find(b => b.id === beatId)
        if (!beat) continue
        const singersHere = new Set(changed.filter(line => sung.get(line)?.beats.has(beatId)).flatMap(line => wanted.get(line)!))
        const missing = [...singersHere].filter(id => !beat.characterIds.includes(id))
        if (missing.length) {
            beat.characterIds = [...beat.characterIds, ...missing]
            result.added.push(...missing.map(character => ({beat: beatId, character})))
            if (data.blocking?.[beatId]) delete data.blocking[beatId]
        }
        if (data.shotMoments?.[beatId] !== undefined) {
            delete data.shotMoments[beatId]
            result.replanned.push(beatId)
        }
    }
    // a kept answer of a stopped run is asked differently now anyway: it goes, so that nothing old comes back
    for (const beatId of result.replanned) delete data.partials?.shotMoments?.[beatId]
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
        const partial = `${file}.${process.pid}.partial`
        writeFileSync(partial, JSON.stringify(data, null, 2))
        renameSync(partial, file)
        return result
    })
}
