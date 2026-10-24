import {existsSync} from "node:fs";
import {join} from "node:path";
import type {Aspect, Resolution} from "../../comfy/helpers.ts";
import {aspectProblem, contextFramesProblem, defaults, finalFpsProblem, finishSettingProblem, interpolationModelProblem, languageName, leakRetriesProblem, workflowDir} from "../config.ts";
import type {Finish} from "../finish.ts";
import {log, warnUnknownKeys} from "../log.ts";

// films/<id>/config.json - the film pipeline's own settings, all optional
export type FilmConfig = {
    // the language of the dialogue of a story idea: "auto" = the language the idea is written in. A screenplay keeps
    // its own language - its dialogue is never translated
    dialogueLanguage: string,
    // seconds of film: an idea is developed for it, and the shots of every scene are planned to it (a scene gets its share of the
    // script's length). A screenplay is planned to a length only when this is written in config.json; -1 = as long as the story needs
    targetDuration: number,
    seed: number,                   // -1 = random per render
    imageResolution: Resolution,    // -1 = workflow, 1.1 = megapixels, "1920x1088" = fixed
    videoResolution: Resolution,
    videoAspect: Aspect,            // the clips' aspect ratio, "16:9" (default), "9:16", "12:5" (scope), ... - as in the music video
    // file names in comfy/workflows/, without .ts - exactly one workflow for the pictures and one for the clips (see docs/custom-workflows.md; a video
    // workflow of the film takes comfy/workflows/h3-ref2video-film.ts's options: pictures only, no audio)
    imageWorkflow: string,
    videoWorkflow: string,
    // every character and location gets a multi-angle reference sheet (a short turnaround video, sampled and composited,
    // see lib/sequenceSheet.ts) instead of one picture - false renders just the picture, which is much cheaper
    sequenceSheets: boolean,
    // the five views of a location's sheet are designed for the place and its story (what lies on the other side, the sides, a wide view) and every shot
    // names the view that is its background - for dialogue between people who face each other, where a reverse shot needs the opposite side of the place.
    // Needs sequenceSheets. Off by default: it adds to every clip prompt, so a film planned without it keeps its prompts
    locationViews: boolean,
    // a clip whose first shot goes on in the same take as the last shot of the clip before starts on that clip's last
    // frame: "auto" = where the shot planning marked it, "scene" = every clip of a scene but its first (the people keep their posture and
    // clothes from clip to clip, but the scene is rendered one clip after the other), "never" (default) = every clip is its own cut.
    // Off by default: a continuing clip starts on whatever the clip before it drifted to, and the drift (doubled people,
    // displaced patches of the set) is carried on and grows - see docs/film.md
    continuity: 'auto' | 'scene' | 'never',
    // a continuing clip (continuity) starts on this many of the last frames of the clip before (0 = off, else 5 + 17·k: 22, 39)
    // instead of its one last frame: the motion goes on, not only the pose - as in the music video (lib/render.ts)
    contextFrames: number,
    // a clip that came out as the reference pictures lined up on their grey backdrop (lib/leak.ts) is rendered again, with
    // another seed, up to this many times. 0 (default) = off
    leakRetries: number,
    // the frame rate of a second film, <id>-<fps>fps.mp4 next to the 24 fps one: the clips get more frames by frame interpolation
    // (a ComfyUI job per clip, shot by shot), the sound is the one of the 24 fps film. 24 (default) = off - as in the music video
    finalFps: number,
    interpolationModel: string,     // a file in ComfyUI's models/frame_interpolation/ (RIFE 4.25/4.26 or FILM)
    // a light grade and sharpen of the film(s), written as <id>-finished.mp4 next to them (lib/finish.ts), with the clips matched
    // to one reference (colorMatch) and film grain when asked for: false (default) = off, true = the mild one, an object = the
    // mild one with its fields replaced - as in the music video
    finish: boolean | Partial<Finish>,
    // subtitles of the film (<id>.srt, and a track in the mp4): "script" = the translations the screenplay has under its lines, "off", or a language
    // code - every line spoken in another language is translated into it
    subtitles: string,
    // the subtitles are burned into the picture (always visible, the video is encoded once more) instead of being a track of the mp4 that the player switches on
    burnSubtitles: boolean,
    // every clip's own sound is brought to about the same loudness (the model makes each clip's level on its own)
    levelMatching: boolean,
    // a score file in input/ (score.mp3, .wav, .flac, .m4a or .ogg) is mixed under the film at this volume in dB (relative to the film's own sound),
    // and ducks under the dialogue
    scoreVolume: number,
    llm: { model?: string },        // a project may use another model than the settings - never another server or key
}

export const filmDefaults: FilmConfig = {
    dialogueLanguage: 'auto',
    targetDuration: 90,
    seed: -1,
    imageResolution: -1,
    videoResolution: -1,
    videoAspect: defaults.videoAspect,
    imageWorkflow: defaults.imageWorkflow,
    videoWorkflow: 'h3-ref2video-film',
    sequenceSheets: true,
    locationViews: false,
    continuity: 'never',
    contextFrames: defaults.contextFrames,
    leakRetries: defaults.leakRetries,
    finalFps: defaults.finalFps,
    interpolationModel: defaults.interpolationModel,
    finish: defaults.finish,
    subtitles: 'script',
    burnSubtitles: false,
    levelMatching: true,
    scoreVolume: -14,
    llm: {},
}

// targetDurationSet: targetDuration is written in config.json - for an idea the default applies anyway, a screenplay is only planned
// to a length when one was asked for
export type LoadedFilmConfig = FilmConfig & { targetDurationSet: boolean }

export async function loadFilmConfig(filmDir: string): Promise<LoadedFilmConfig> {
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
    const aspectWrong = aspectProblem(config.videoAspect)
    if (aspectWrong) fail(aspectWrong)
    for (const key of ['imageWorkflow', 'videoWorkflow'] as const) {
        if (!existsSync(join(workflowDir, `${config[key]}.ts`))) fail(`${key}: no workflow comfy/workflows/${config[key]}.ts`)
    }
    if (typeof config.sequenceSheets !== 'boolean') fail(`sequenceSheets must be true or false, got ${JSON.stringify(config.sequenceSheets)}`)
    if (typeof config.locationViews !== 'boolean') fail(`locationViews must be true or false, got ${JSON.stringify(config.locationViews)}`)
    if (config.locationViews && !config.sequenceSheets) fail('locationViews needs sequenceSheets: true - the views are the pictures of the location sheet')
    for (const problem of [contextFramesProblem(config.contextFrames), leakRetriesProblem(config.leakRetries), finalFpsProblem(config.finalFps),
        finishSettingProblem(config.finish), interpolationModelProblem(config.interpolationModel)]) if (problem) fail(problem)
    if (config.contextFrames > 0 && config.continuity === 'never') log.warn(`${file}: contextFrames ${config.contextFrames} does nothing while "continuity" is "never" - no clip goes on from the one before`)
    if (!['auto', 'scene', 'never'].includes(config.continuity)) fail(`continuity must be "auto", "scene" or "never", got ${JSON.stringify(config.continuity)}`)
    if (config.subtitles !== 'script' && config.subtitles !== 'off' && (typeof config.subtitles !== 'string' || !languageName(config.subtitles))) fail(`subtitles must be "script", "off" or a language code like "en", got ${JSON.stringify(config.subtitles)}`)
    if (typeof config.burnSubtitles !== 'boolean') fail(`burnSubtitles must be true or false, got ${JSON.stringify(config.burnSubtitles)}`)
    if (typeof config.levelMatching !== 'boolean') fail(`levelMatching must be true or false, got ${JSON.stringify(config.levelMatching)}`)
    if (!Number.isFinite(config.scoreVolume) || config.scoreVolume > 0 || config.scoreVolume < -40) fail(`scoreVolume must be between -40 and 0 dB, got ${JSON.stringify(config.scoreVolume)}`)
    if (!config.llm || typeof config.llm !== 'object' || Array.isArray(config.llm)) fail(`llm must be an object like {"model": "…"}, got ${JSON.stringify(config.llm)}`)
    const llmKeys = Object.keys(config.llm).filter(key => key !== 'model')
    if (llmKeys.length) fail(`llm: a project can only set "model" - the server and API key are in the settings (bun run setup llm), got ${llmKeys.join(', ')}`)
    if (config.llm.model !== undefined && (typeof config.llm.model !== 'string' || !config.llm.model.trim())) {
        fail(`llm.model must be a model id of the LLM server, got ${JSON.stringify(config.llm.model)}`)
    }
    return {...config, targetDurationSet: 'targetDuration' in raw}
}
