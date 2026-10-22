import {existsSync} from "node:fs";
import {join} from "node:path";
import type {FilmConfig} from "./config.ts";
import type {FilmInput, FilmStepName} from "./store.ts";
import type {FilmMode, FilmProject} from "./types.ts";

// What a film's steps are made from besides each other - the input files and the settings, fingerprinted in project.json -
// and which steps a film uses at all. For film.ts (syncInputs), --dry-run and bun run status --film.

const readInput = async (dir: string, name: string) => existsSync(join(dir, 'input', name)) ? (await Bun.file(join(dir, 'input', name)).text()).trim() : ''

/** A film is made from a screenplay when input/screenplay.txt has one, else it develops input/idea.txt. */
export const filmMode = async (dir: string): Promise<FilmMode> => await readInput(dir, 'screenplay.txt') ? 'screenplay' : 'idea'

/** Every input and setting of a film with the steps an edit of it redoes. */
export async function filmInputs(dir: string, config: FilmConfig): Promise<Record<string, FilmInput>> {
    return {
        'idea.txt': {value: await readInput(dir, 'idea.txt'), steps: ['brief']},
        'screenplay.txt': {value: await readInput(dir, 'screenplay.txt'), steps: ['brief']},
        dialogueLanguage: {value: config.dialogueLanguage, steps: ['brief']},
        targetDuration: {value: String(config.targetDuration), steps: ['outline', 'coverage']},
        'style.txt': {value: await readInput(dir, 'style.txt'), steps: ['lookBrief']},
        subtitles: {value: config.subtitles, steps: ['subtitles']},
        // designed views of the places change what the coverage is planned against
        sequenceViews: {value: `${config.sequenceSheets}:${config.locationViews}`, steps: ['locationViews', 'coverage']},
    }
}

/** Whether a film makes this step at all - the others are shown as not used. */
export function filmStepUsed(step: FilmStepName, mode: FilmMode, data: FilmProject, config: FilmConfig): boolean {
    switch (step) {
        case 'outline': return mode === 'idea'
        case 'locationViews': return config.sequenceSheets && config.locationViews
        // only a repair of the script makes them (an idea's own script, or --fix-script)
        case 'scriptFixes': return data.scriptFixes !== undefined
        case 'subtitles': return config.subtitles !== 'script' && config.subtitles !== 'off'
        default: return true
    }
}
