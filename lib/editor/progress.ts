import {existsSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {clipFolder, readOptions, variantOf} from '../refinish.ts'
import type {ClipProgress, RunProgress} from '../../shared/workspace.ts'
export type {ClipProgress, RunProgress, Explained} from '../../shared/workspace.ts'

// How far a run has come, clip by clip, from what it leaves in the project folder and nothing else: a job on a server has its
// <file>.pending.json (lib/render.ts), and a clip that is done has a file newer than the start of the run. So it also holds for a
// run started in the terminal, and the CLI prints what it always printed.

/** A value of an option of a command line. */
const optionOf = (tokens: string[], name: string) => tokens.find(token => token.startsWith(`--${name}=`))?.slice(name.length + 3)

/** The clips a run is working on and where each stands - undefined for a run that renders no clips. `clipIds`: all clips of the project. */
export function runProgress(dir: string, command: string, startedAt: number, clipIds: string[]): RunProgress | undefined {
    const tokens = command.trim().split(/\s+/)
    if (tokens[1]?.endsWith('refinish.ts')) return refinishProgress(dir, tokens, clipIds)
    const retake = optionOf(tokens, 'retake')
    if (retake) {
        const id = retake.split(':')[0]!
        return summed({[id]: existsSync(join(dir, 'assets', 'clips', `${id}_retake.mp4.pending.json`)) ? 'rendering' : 'waiting'})
    }
    if (
        !optionOf(tokens, 'render')
            ?.split(',')
            .some(what => what === 'videos' || what === 'all')
    )
        return undefined
    const only = optionOf(tokens, 'only')?.split(',')
    const again = tokens.includes('--again')
    const folder = tokens.includes('--preview') ? 'previews' : 'videos'
    const clips: Record<string, ClipProgress> = {}
    for (const id of only ? clipIds.filter(clip => only.includes(clip)) : clipIds) {
        const file = join(dir, folder, `${id}.mp4`)
        if (existsSync(`${file}.pending.json`)) clips[id] = 'rendering'
        else if (!existsSync(file)) clips[id] = 'waiting'
        else if (statSync(file).mtimeMs >= startedAt) clips[id] = 'done'
        // there from before, and not asked to be made again: this run has nothing to do with it. With --again it is put away first
        else if (again) clips[id] = 'waiting'
    }
    return summed(clips)
}

/** A refinish makes larger clips: a clip has its file in the folder of its variant when it is done. Without larger clips there is nothing to count. */
function refinishProgress(dir: string, tokens: string[], clipIds: string[]): RunProgress | undefined {
    const value = (name: string) => optionOf(tokens, name)
    try {
        const options = readOptions({
            preset: value('preset'),
            upscale: value('upscale'),
            size: value('size'),
            model: value('model'),
            denoise: value('denoise'),
            fps: value('fps'),
            finish: tokens.includes('--finish'),
        })
        if (options.upscale === 'none') return undefined
        const only = value('only')?.split(',')
        const folder = join(dir, clipFolder(variantOf(options)))
        return summed(
            Object.fromEntries(
                (only ? clipIds.filter(id => only.includes(id)) : clipIds).map(id => [
                    id,
                    existsSync(join(folder, `${id}.mp4`)) ? 'done' : existsSync(join(folder, `${id}.rendered.mp4.pending.json`)) ? 'rendering' : 'waiting',
                ]),
            ),
        )
    } catch {
        return undefined
    }
}

function summed(clips: Record<string, ClipProgress>): RunProgress {
    const states = Object.values(clips)
    return {clips, done: states.filter(state => state === 'done').length, total: states.length}
}

// what a failure means and what to do: lib/failure-help.ts - the terminal says the same
export {explainFailure} from '../failure-help.ts'
