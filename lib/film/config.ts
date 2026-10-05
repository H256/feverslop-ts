import {existsSync} from "node:fs";
import {join} from "node:path";
import type {Resolution} from "../../comfy/helpers.ts";
import {languageName} from "../config.ts";
import {warnUnknownKeys} from "../log.ts";

// films/<id>/config.json - the film pipeline's own settings, all optional
export type FilmConfig = {
    // the language of the dialogue of a story idea: "auto" = the language the idea is written in. A screenplay keeps
    // its own language - its dialogue is never translated
    dialogueLanguage: string,
    targetDuration: number,         // seconds of film an idea is developed for; -1 = as long as the story needs
    seed: number,                   // -1 = random per render
    imageResolution: Resolution,    // -1 = workflow, 1.1 = megapixels, "1920x1088" = fixed
    videoResolution: Resolution,
    // every character and location gets a multi-angle reference sheet (a short turnaround video, sampled and composited,
    // see lib/sequenceSheet.ts) instead of one picture - false renders just the picture, which is much cheaper
    sequenceSheets: boolean,
    llm: { model?: string },        // a project may use another model than the settings - never another server or key
}

export const filmDefaults: FilmConfig = {
    dialogueLanguage: 'auto',
    targetDuration: 90,
    seed: -1,
    imageResolution: -1,
    videoResolution: -1,
    sequenceSheets: true,
    llm: {},
}

export async function loadFilmConfig(filmDir: string): Promise<FilmConfig> {
    const file = join(filmDir, 'config.json')
    const fail = (message: string): never => {
        throw new Error(`${file}: ${message}`)
    }
    let raw: Partial<FilmConfig> = {}
    if (existsSync(file)) {
        try {
            raw = await Bun.file(file).json()
        } catch (e) {
            fail(`is not valid JSON (${e instanceof Error ? e.message : String(e)}) - fix it, or delete the file to use the defaults`)
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object like {"targetDuration": 120}')
    const config: FilmConfig = {...filmDefaults, ...raw}
    warnUnknownKeys(raw, Object.keys(filmDefaults), file)

    if (config.dialogueLanguage !== 'auto' && (typeof config.dialogueLanguage !== 'string' || !languageName(config.dialogueLanguage))) {
        fail(`dialogueLanguage must be "auto" or a language code like "en" or "de", got ${JSON.stringify(config.dialogueLanguage)}`)
    }
    if (!Number.isFinite(config.targetDuration) || (config.targetDuration !== -1 && config.targetDuration < 10)) {
        fail(`targetDuration must be -1 (as long as the story needs) or at least 10 seconds, got ${JSON.stringify(config.targetDuration)}`)
    }
    if (!Number.isInteger(config.seed) || config.seed < -1) fail(`seed must be -1 or a whole number >= 0, got ${JSON.stringify(config.seed)}`)
    for (const key of ['imageResolution', 'videoResolution'] as const) {
        const value = config[key]
        if (!(value === -1 || (typeof value === 'number' && value > 0) || /^\d+x\d+$/.test(String(value)))) {
            fail(`${key} must be -1, megapixels like 1.1 or "WIDTHxHEIGHT", got ${JSON.stringify(value)}`)
        }
    }
    if (typeof config.sequenceSheets !== 'boolean') fail(`sequenceSheets must be true or false, got ${JSON.stringify(config.sequenceSheets)}`)
    if (!config.llm || typeof config.llm !== 'object' || Array.isArray(config.llm)) fail(`llm must be an object like {"model": "…"}, got ${JSON.stringify(config.llm)}`)
    const llmKeys = Object.keys(config.llm).filter(key => key !== 'model')
    if (llmKeys.length) fail(`llm: a project can only set "model" - the server and API key are in the settings (bun run setup llm), got ${llmKeys.join(', ')}`)
    if (config.llm.model !== undefined && (typeof config.llm.model !== 'string' || !config.llm.model.trim())) {
        fail(`llm.model must be a model id of the LLM server, got ${JSON.stringify(config.llm.model)}`)
    }
    return config
}
