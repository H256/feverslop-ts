// A character or a place described straight from its picture by a vision-capable model (import-asset, create-asset) -
// the same shape and rules as the descriptions the pipeline writes from its own look prompts.

import {rmSync} from "node:fs";
import {ask} from "./llm.ts";
import {runProcess} from "./process.ts";
import {characterImageDescriptionPrompt, locationImageDescriptionPrompt} from "./prompts.ts";

// full-resolution pictures made a local vision model hang for minutes on one request - a description needs no more than this
const VISION_MAX_WIDTH = 512

/** The description from the picture - the LLM must be configured. Throws when the model fails (e.g. takes no images). */
export async function describePicture(image: string, subject: { kind: 'character', name: string, role: string } | { kind: 'location', name: string }): Promise<string | undefined> {
    const small = `${image}.vision.png`
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', image, '-vf', `scale=${VISION_MAX_WIDTH}:-1`, small], {errorMessage: err => `ffmpeg could not downscale ${image}:\n${err}`})
    const url = `data:image/png;base64,${Buffer.from(await Bun.file(small).arrayBuffer()).toString('base64')}`
    rmSync(small, {force: true})
    const prompt = subject.kind === 'character' ? characterImageDescriptionPrompt(url, subject) : locationImageDescriptionPrompt(url, subject.name)
    return (await ask(prompt)).trim() || undefined
}
