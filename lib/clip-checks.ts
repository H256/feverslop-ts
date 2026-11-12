import {existsSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import type {JoinRecord} from './film/joins.ts'
import {median} from './predict.ts'

// What the checks of rendered clips found, kept next to the project for the workspace to mark the clips by (#836):
// texture-chains (output/texture-chains.json) and, for a film, film:check-joins (output/join-check.json). A finding
// counts only for the very files it was made on - a clip rendered again since says nothing about it until checked again.

/** A clip's file, as the checks name it: its time of change, rounded to the millisecond (as output/leak-scan.json). */
export const videoStamp = (dir: string, clip: string) => {
    const file = join(dir, 'videos', `${clip}.mp4`)
    return existsSync(file) ? Math.round(statSync(file).mtimeMs) : undefined
}

export type TextureJoin = {from: string; to: string; kind: 'context' | 'last frame' | 'cut'; fine: number; structure: number}
/** A continuing join with more fine detail than clips differ by anyway, by the clip that goes on. */
export type GrittyJoin = {from: string; fine: number; usual: number; videos: [number, number]}
export const TEXTURE_FILE = join('output', 'texture-chains.json')

/** The continuing joins that got grittier than an ordinary cut changes a clip: the fine detail up by a fifth more than at the median cut. */
export function grittierJoins(joins: TextureJoin[], margin = 1.2): (TextureJoin & {usual: number})[] {
    const cuts = joins.filter(j => j.kind === 'cut').map(j => j.fine)
    const usual = cuts.length ? median(cuts) : 1
    return joins.filter(j => j.kind !== 'cut' && j.fine > usual * margin).map(j => ({...j, usual}))
}

/** What output/texture-chains.json keeps: the gritty joins by the clip that goes on, with the files they were measured on. */
export function textureFindings(dir: string, joins: TextureJoin[]): {at: string; gritty: Record<string, GrittyJoin>} {
    const gritty = Object.fromEntries(
        grittierJoins(joins).map((j): [string, GrittyJoin] => [
            j.to,
            {from: j.from, fine: j.fine, usual: j.usual, videos: [videoStamp(dir, j.from) ?? 0, videoStamp(dir, j.to) ?? 0]},
        ]),
    )
    return {at: new Date().toISOString(), gritty}
}

/** A join of film:check-joins, with the files it was asked on (older records have none and mark nothing). */
export type CheckedJoin = JoinRecord & {videos?: [number, number]}
export const JOINS_FILE = join('output', 'join-check.json')

export type ClipCheckMark = {kind: 'grittier' | 'join'; text: string}

const readJson = <T>(file: string): T | undefined => {
    try {
        return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined
    } catch {
        return undefined
    }
}

/** Reads both findings once for a project; the function it gives says what is found against one clip. */
export function clipCheckMarks(dir: string): (clip: string) => ClipCheckMark[] {
    const gritty = readJson<{gritty?: Record<string, GrittyJoin>}>(join(dir, TEXTURE_FILE))?.gritty ?? {}
    const joins = Object.entries(readJson<Record<string, CheckedJoin>>(join(dir, JOINS_FILE)) ?? {})
    const current = (from: string, to: string, videos?: [number, number]) =>
        !!videos && videoStamp(dir, from) === videos[0] && videoStamp(dir, to) === videos[1]
    return clip => {
        const marks: ClipCheckMark[] = []
        const found = gritty[clip]
        if (found && current(found.from, clip, found.videos))
            marks.push({
                kind: 'grittier',
                text: `Grittier than ${found.from} it goes on from: fine detail x${found.fine.toFixed(2)} (at an ordinary cut x${found.usual.toFixed(2)})`,
            })
        for (const [key, record] of joins) {
            const [from, to] = key.split('>')
            if (to !== clip || record.fits || !current(from!, clip, record.videos)) continue
            marks.push({kind: 'join', text: `At the cut from ${from}: ${record.differences.join(' · ')}`})
        }
        return marks
    }
}
