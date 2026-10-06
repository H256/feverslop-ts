import {existsSync, mkdirSync, renameSync} from "node:fs";
import {join} from "node:path";
import {filmBoundaryFrame} from "./compose.ts";

/** Puts a rendered clip - the video and its first and last frame - away in old/attempts/, so that it can be rendered again and the old one is still there. */
export function archiveClip(projectDir: string, clipId: string, label: string) {
    const keep = join(projectDir, 'old', 'attempts', `${clipId}-${label}`)
    mkdirSync(keep, {recursive: true})
    const lastFrame = filmBoundaryFrame(clipId)
    for (const file of [join('videos', `${clipId}.mp4`), join('videos', `${clipId}.mp4.json`), lastFrame, lastFrame.replace(/_lf\.png$/, '_ff.png')]) {
        const from = join(projectDir, file)
        if (existsSync(from)) renameSync(from, join(keep, file.split(/[\/]/).at(-1)!))
    }
    return keep
}
