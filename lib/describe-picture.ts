// A character or a place described straight from its picture by a vision-capable model (import-asset, create-asset) -
// the same shape and rules as the descriptions the pipeline writes from its own look prompts.

import {existsSync, rmSync} from "node:fs";
import {join} from "node:path";
import {ask} from "./llm.ts";
import {runProcess} from "./process.ts";
import {characterImageDescriptionPrompt, locationImageDescriptionPrompt} from "./prompts.ts";

// full-resolution pictures made a local vision model hang for minutes on one request - a description needs no more than this
const VISION_MAX_WIDTH = 512

/**
 * The pictures a character is described from: its anchor, and the full-body views of its sheet when it has one (frame 0 is the
 * front, frame 4 the back - lib/sequenceSheet.ts) - the clips are given the sheet, and an anchor cut at the waist says nothing
 * of the legs and shoes the sheet shows.
 */
export const characterViews = (sheetDir: string) => [join(sheetDir, 'anchor.png'), join(sheetDir, 'frames', 'frame_00.png'), join(sheetDir, 'frames', 'frame_04.png')].filter(existsSync)

/** Pictures as data URLs for a vision-capable model, at a small size. */
export function visionUrls(files: string[]): Promise<string[]> {
    return Promise.all(files.map(async (image, i) => {
        const small = `${image}.vision-${i}.png`
        await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', image, '-vf', `scale=${VISION_MAX_WIDTH}:-1`, small], {errorMessage: err => `ffmpeg could not downscale ${image}:\n${err}`})
        const url = `data:image/png;base64,${Buffer.from(await Bun.file(small).arrayBuffer()).toString('base64')}`
        rmSync(small, {force: true})
        return url
    }))
}

/**
 * The description from the picture(s) - the LLM must be configured. A character can be given several pictures of it (its anchor
 * and full-body views), a place one. Throws when the model fails (e.g. takes no images).
 */
export async function describePicture(images: string | string[], subject: { kind: 'character', name: string, role: string } | { kind: 'location', name: string }): Promise<string | undefined> {
    const urls = await visionUrls([images].flat())
    const prompt = subject.kind === 'character' ? characterImageDescriptionPrompt(urls, subject) : locationImageDescriptionPrompt(urls[0]!, subject.name)
    return (await ask(prompt)).trim() || undefined
}
