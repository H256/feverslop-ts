import {existsSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {clipFolder, readOptions, variantOf} from '../refinish.ts'
import type {ClipProgress, RunProgress, Explained} from '../../shared/workspace.ts'
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

/**
 * What a failure of a run means, in plain words, for the failures that can be told surely - by the messages of ComfyUI and of this
 * program, never a text of a language model. The others stay as they are.
 */
export function explainFailure(failure: string): Explained | undefined {
    if (/out of memory/i.test(failure))
        return {text: 'The render server ran out of memory on this job.', action: 'Repeat on another server, or render a shorter clip or at a smaller size.'}
    if (/has not answered for|No ComfyUI server reachable/.test(failure))
        return {
            text: 'A render server does not answer.',
            action: 'Start it again and repeat: a job that is still queued is picked up. Or repeat on another server.',
        }
    if (/being worked on by another run/.test(failure)) return {text: 'Another run is working on this project.', action: 'Wait for it, or stop it.'}
    if (/casting\.json/.test(failure)) return {text: 'casting.json names something the library does not have.', action: 'Change the entry on the Casting page.'}
    return undefined
}
