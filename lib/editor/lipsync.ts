import {existsSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {songFileOf} from '../inputs.ts'
import {audioPrints, lipsyncFile, lipsyncFingerprint, lipsyncRequests, recordedLipsync} from '../lipsync.ts'
import type {Project} from '../project.ts'
import {fingerprint} from '../provenance.ts'
import {loadProjectConfig} from '../config.ts'
import type {LipsyncView} from '../../shared/workspace.ts'
import type {EditorTarget} from './project.ts'

export type {LipsyncView} from '../../shared/workspace.ts'

/**
 * The lip-sync preview of a music video as the Timing page shows it (#1016): every clip of the cut, and whether its file in previews/lipsync/ is
 * made from the prompt, the cut, the size and the audio the project has now. undefined without timed lyrics or a cut - nothing to preview.
 */
export async function readLipsync(target: EditorTarget, peaksOf?: (file: string) => Promise<number[] | undefined>): Promise<LipsyncView | undefined> {
    const file = join(target.dir, 'project.json')
    if (!existsSync(file)) return undefined
    const data = JSON.parse(readFileSync(file, 'utf8')) as Project
    const config = await loadProjectConfig(target.dir)
    const vocals = data.stems?.vocals ? join(target.dir, data.stems.vocals) : undefined
    const peaks = vocals && peaksOf && existsSync(vocals) ? await peaksOf(vocals) : undefined
    const clips = lipsyncRequests(data, config, peaks)
    if (!clips.length) return undefined
    const prints = audioPrints(target.dir, data, songFileOf(target.dir))
    let size: string | undefined
    const view: LipsyncView['clips'] = clips.map(clip => {
        const path = join(target.dir, lipsyncFile(clip.id))
        const made = recordedLipsync(path)
        size ??= made?.size
        const state = !made ? 'missing' : made.fingerprint === fingerprint(...lipsyncFingerprint(clip, config, prints)) ? 'current' : 'outdated'
        return {
            id: clip.id,
            start: clip.start,
            end: clip.end,
            state,
            ...(made ? {video: {file: lipsyncFile(clip.id), v: Math.round(statSync(path).mtimeMs)}} : {}),
            shots: clip.shots,
        }
    })
    return {clips: view, settings: {scale: config.lipsyncScale, dummies: config.lipsyncDummies, ...(size ? {size} : {})}}
}
