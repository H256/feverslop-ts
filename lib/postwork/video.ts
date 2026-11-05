import {existsSync, renameSync, rmSync} from "node:fs";
import {basename, join} from "node:path";
import {startSpinner, styles} from "../log.ts";

// What the post-work steps share: which final video a step starts from, the name of what it writes, and the encode.
// A step reads one video of the project folder and writes a new one next to it, the name of the old one with its own
// ending - so the steps chain in any order (<id>-labeled.mp4, then <id>-labeled-credits.mp4) and nothing is overwritten.

/** The ending of each step's video, and what the workspace calls it (lib/editor/project.ts finalLabel). */
export const POSTWORK_ENDINGS = {labeled: 'AI label', credits: 'credits', intro: 'intro'} as const
export type PostworkEnding = keyof typeof POSTWORK_ENDINGS
export const POSTWORK_ENDING_NAMES = Object.keys(POSTWORK_ENDINGS) as PostworkEnding[]

/** `<name>.mp4` -> `<name>-<ending>.mp4` */
export const postworkName = (video: string, ending: PostworkEnding) => video.replace(/\.mp4$/, `-${ending}.mp4`)

/** A file name a step may start from: a video right in the project folder, no path. */
export const VIDEO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/

/**
 * The video a step starts from: `from` when given (a file name in the project folder), else the finished final video
 * (<id>-finished.mp4) when there is one, else the final video (<id>.mp4). Throws when it is not there.
 */
export function sourceVideo(dir: string, id: string, from?: string): string {
    if (from !== undefined) {
        if (!VIDEO_NAME.test(from) || from.endsWith('.partial.mp4')) throw new Error(`--from: "${from}" is not a video of the project - give the file name of one in ${dir}, e.g. ${id}.mp4`)
        if (!existsSync(join(dir, from))) throw new Error(`--from: there is no ${from} in ${dir}`)
        return join(dir, from)
    }
    const found = [`${id}-finished.mp4`, `${id}.mp4`].map(name => join(dir, name)).find(file => existsSync(file))
    if (!found) throw new Error(`${id} has no final video yet (${id}.mp4) - render it first, or say which video with --from=<file>`)
    return found
}

/** The encode of a step's video: the settings of the final video, so a step adds no visible loss of its own. */
export const VIDEO_ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']

/**
 * Runs ffmpeg into `target`: written as <target>.partial.mp4 first and renamed when done, so a stopped run leaves no half
 * video under the real name. `frames`: how many the output has, for the progress shown; `what`: what it is doing.
 */
export async function encode(args: string[], target: string, frames: number, what: string, cwd?: string): Promise<void> {
    const partial = `${target}.partial.mp4`
    let frame = 0
    const stopSpinner = startSpinner(() => `${styles.name('ffmpeg')} ${styles.muted(`${what}${frame ? ` - frame ${frame} / ${frames}` : ''}`)}`)
    try {
        const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', ...args, partial], {stdout: 'pipe', stderr: 'pipe', ...(cwd ? {cwd} : {})})
        const stderr = new Response(proc.stderr).text()
        for await (const chunk of proc.stdout) {
            const found = new TextDecoder().decode(chunk).match(/frame=(\d+)/g)
            if (found) frame = Number(found.at(-1)!.slice(6))
        }
        if (await proc.exited !== 0) throw new Error(`ffmpeg could not write ${basename(target)}:\n${await stderr}`)
    } catch (e) {
        rmSync(partial, {force: true})
        throw e
    } finally {
        stopSpinner()
    }
    renameSync(partial, target)
}
