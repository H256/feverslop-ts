import {existsSync} from "node:fs";
import {join} from "node:path";
import type {Resolution} from "../comfy/helpers.ts";
import {warnUnknownKeys} from "./log.ts";

// projects/<id>/config.json - documented in docs/comfyui.md
export type RenderConfig = {
    seed: number,                   // -1 = random per render
    imageResolution: Resolution,    // -1 = workflow, 1.1 = megapixels, "1920x1088" = fixed
    videoResolution: Resolution,
    imageWorkflow: string,          // file name in comfy/workflows/, without .ts
    videoWorkflow: string,
    songAudio: boolean,             // final video: the original song replaces the clips' own audio
    songWorkflow: string,           // file name in comfy/workflows/, without .ts - used by --render=song
    songDuration: number,           // seconds - an upper bound for a generated song; -1 = the workflow's own default
    // every character and location gets a multi-angle reference sheet (turnaround video -> sampled frames ->
    // composited grid) instead of one flat hero image - see lib/sequenceSheet.ts. Off falls back to the plain
    // hero image (the old renderPicture path) - useful to cut render cost while iterating on a project.
    sequenceSheets: boolean,
    sequenceWorkflow: string,       // file name in comfy/workflows/, without .ts
    // a continuing clip (config.continuity) is also pinned to the last frame of the clip before it as its first frame
    // (MiniMaxH3AddGuide), not only given it as a reference picture
    pinStartFrame: boolean,
}

export type SingerVoice = 'auto' | 'female' | 'male' | 'mixed'

export type PlanConfig = {
    singers: string[],              // [] = clip mode, ["auto"] = the LLM picks, or character names / ids
    // voice of the song: "auto" = whatever the story gives, "female"/"male" = everybody who sings is a woman/man,
    // "mixed" = a duet of one woman and one man
    singerVoice: SingerVoice,
    lyricsLanguage: string,         // ISO 639-1 code, for Whisper and the <d>[Language] tag
    alignLyrics: boolean,           // stems + transcript + real lyric timing - default: on when someone sings
    // clips of one beat that run on without a cut start on the previous clip's last frame: "auto" = the beats the story
    // planning marked as one continuous take, "always" = every clip but the first of each beat, "never" (default) = every
    // clip is its own cut. Off by default: a continuing clip starts on whatever the clip before it drifted to, and the
    // drift (doubled people, displaced wall patches) is carried on and grows - see README "Continuous scenes"
    continuity: 'auto' | 'always' | 'never',
}

// a project may use another model than the settings - never another server or key
export type LlmConfig = { llm: { model?: string } }

export type ProjectConfig = RenderConfig & PlanConfig & LlmConfig

export const defaults: Omit<ProjectConfig, 'alignLyrics'> = {
    seed: -1,
    imageResolution: -1,
    videoResolution: -1,
    imageWorkflow: 'kroma-image',
    videoWorkflow: 'h3-ref2video',
    songAudio: true,
    songWorkflow: 'yue2-song',
    songDuration: -1,
    sequenceSheets: true,
    sequenceWorkflow: 'h3-sequence-to-sheet',
    pinStartFrame: true,
    singers: [],
    singerVoice: 'auto',
    lyricsLanguage: 'en',
    continuity: 'never',
    llm: {},
}
export const workflowDir = join(import.meta.dir, '..', 'comfy', 'workflows')

export async function loadProjectConfig(projectDir: string): Promise<ProjectConfig> {
    const file = join(projectDir, 'config.json')
    const fail = (message: string): never => {
        throw new Error(`${file}: ${message}`)
    }
    let raw: Partial<ProjectConfig> = {}
    if (existsSync(file)) {
        try {
            raw = await Bun.file(file).json()
        } catch (e) {
            fail(`is not valid JSON (${e instanceof Error ? e.message : String(e)}) - fix it, or delete the file to use the defaults`)
        }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object like {"seed": 42}')
    const merged = {...defaults, ...raw}
    const config: ProjectConfig = {...merged, alignLyrics: raw.alignLyrics ?? (Array.isArray(merged.singers) && merged.singers.length > 0)}

    // the keys of `config` can't be the allowed ones - a typo'd key from `raw` is in there too
    warnUnknownKeys(raw, [...Object.keys(defaults), 'alignLyrics'], file)

    if (!Number.isInteger(config.seed) || config.seed < -1) fail(`seed must be -1 or a whole number >= 0, got ${JSON.stringify(config.seed)}`)
    for (const key of ['imageResolution', 'videoResolution'] as const) {
        const value = config[key]
        if (!(value === -1 || (typeof value === 'number' && value > 0) || /^\d+x\d+$/.test(String(value)))) {
            fail(`${key} must be -1, megapixels like 1.1 or "WIDTHxHEIGHT", got ${JSON.stringify(value)}`)
        }
    }
    if (typeof config.songAudio !== 'boolean') fail(`songAudio must be true or false, got ${JSON.stringify(config.songAudio)}`)
    if (typeof config.pinStartFrame !== 'boolean') fail(`pinStartFrame must be true or false, got ${JSON.stringify(config.pinStartFrame)}`)
    if (typeof config.sequenceSheets !== 'boolean') fail(`sequenceSheets must be true or false, got ${JSON.stringify(config.sequenceSheets)}`)
    for (const key of ['imageWorkflow', 'videoWorkflow', 'songWorkflow', 'sequenceWorkflow'] as const) {
        if (!existsSync(join(workflowDir, `${config[key]}.ts`))) fail(`${key}: no workflow comfy/workflows/${config[key]}.ts`)
    }
    if (!Number.isFinite(config.songDuration) || (config.songDuration !== -1 && config.songDuration <= 0)) {
        fail(`songDuration must be -1 (the workflow's own default) or a positive number of seconds, got ${JSON.stringify(config.songDuration)}`)
    }

    if (!Array.isArray(config.singers) || config.singers.some(s => typeof s !== 'string' || !s.trim())) {
        fail(`singers must be a list of character names, e.g. ["auto"] or ["Thorin"], got ${JSON.stringify(config.singers)}`)
    }
    if (config.singers.includes('auto') && config.singers.length > 1) fail(`singers: "auto" can't be combined with names, got ${JSON.stringify(config.singers)}`)
    if (!['auto', 'female', 'male', 'mixed'].includes(config.singerVoice)) fail(`singerVoice must be "auto", "female", "male" or "mixed", got ${JSON.stringify(config.singerVoice)}`)
    if (typeof config.lyricsLanguage !== 'string' || !languageName(config.lyricsLanguage)) {
        fail(`lyricsLanguage must be a language code like "en" or "de", got ${JSON.stringify(config.lyricsLanguage)}`)
    }
    if (!['auto', 'always', 'never'].includes(config.continuity)) fail(`continuity must be "auto", "always" or "never", got ${JSON.stringify(config.continuity)}`)
    if (typeof config.alignLyrics !== 'boolean') fail(`alignLyrics must be true or false, got ${JSON.stringify(config.alignLyrics)}`)
    if (config.singers.length && !config.alignLyrics) fail('singers need the lyrics timing - remove "alignLyrics": false')

    if (!config.llm || typeof config.llm !== 'object' || Array.isArray(config.llm)) fail(`llm must be an object like {"model": "…"}, got ${JSON.stringify(config.llm)}`)
    const llmKeys = Object.keys(config.llm).filter(key => key !== 'model')
    if (llmKeys.length) fail(`llm: a project can only set "model" - the server and API key are in the settings (bun run setup llm), got ${llmKeys.join(', ')}`)
    if (config.llm.model !== undefined && (typeof config.llm.model !== 'string' || !config.llm.model.trim())) {
        fail(`llm.model must be a model id of the LLM server, got ${JSON.stringify(config.llm.model)}`)
    }
    return config
}

// "en" -> "English", undefined for codes that aren't a language
export function languageName(code: string) {
    try {
        const name = new Intl.DisplayNames(['en'], {type: 'language', fallback: 'none'}).of(code)
        return name && name.toLowerCase() !== code.toLowerCase() ? name : undefined
    } catch {
        return undefined
    }
}
