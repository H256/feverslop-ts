import {existsSync} from "node:fs";
import {join} from "node:path";
import type {ProjectConfig} from "./config.ts";
import type {Project, StepName, TrackedInput} from "./project.ts";

// The inputs of a project whose change redoes steps - the files in input/ and the settings of config.json that steps are
// built on, each with the steps it redoes. One place for index.ts (which redoes them) and bun run status (which only says so).

/** An input file's text, trimmed - '' when there is none. */
export async function readInput(dir: string, name: string) {
    const file = join(dir, 'input', name)
    return existsSync(file) ? (await Bun.file(file).text()).trim() : ''
}

/** The song a project uses: input/song.wav, else a hand-supplied input/song.mp3 - song.wav when there is neither (yet). */
export function songFileOf(dir: string) {
    const wav = join(dir, 'input', 'song.wav')
    const mp3 = join(dir, 'input', 'song.mp3')
    return existsSync(wav) ? wav : existsSync(mp3) ? mp3 : wav
}

export async function projectInputs(dir: string, config: ProjectConfig): Promise<Record<string, TrackedInput>> {
    const songFile = songFileOf(dir)
    return {
        // no "assumed" for these three - unlike the ones below, they never existed before this feature, so there is
        // no old project to treat as unchanged; on a real first run "previous" is simply undefined and nothing redoes
        'idea.txt': {value: await readInput(dir, 'idea.txt'), steps: ['songStyle']},
        'music-style.txt': {value: await readInput(dir, 'music-style.txt'), steps: ['songStyle']},
        'song.wav': {value: existsSync(songFile) ? await Bun.file(songFile).bytes() : '', steps: ['music', 'stems']},
        'lyrics.txt': {value: await readInput(dir, 'lyrics.txt'), steps: ['story', 'transcript', 'singing', 'songStyle']},
        'story-idea.txt': {value: await readInput(dir, 'story-idea.txt'), steps: ['story']},
        'style.txt': {value: await readInput(dir, 'style.txt'), steps: ['lookBrief'], assumed: ''},
        singers: {value: JSON.stringify(config.singers), steps: ['singing'], assumed: '[]'},
        singerVoice: {value: config.singerVoice, steps: ['story'], assumed: 'auto'},
        lyricsLanguage: {value: config.lyricsLanguage, steps: ['transcript'], assumed: 'en'},
        // which beats run on without a cut changes what their shots have to tell
        // assumed: what a project recorded before the default became "never" ran with - so it is not redone by the new default alone
        continuity: {value: config.continuity, steps: ['blocking'], assumed: 'auto'},
        // the choice of views is made again when the mode changes - it is only made at all with "auto"
        locationView: {value: String(config.sequenceSheets ? config.locationView : -1), steps: ['shotViews'], assumed: '-1'},
        // fight beats cut into one-bar pieces change how many shots a beat has
        fightClips: {value: String(config.fightClips), steps: ['blocking'], assumed: 'false'},
    }
}

/** Whether the pipeline runs a step at all for this project - the others are not missing, they are not used. */
export function stepUsed(step: StepName, dir: string, data: Project, config: ProjectConfig): boolean {
    const props = new Set((data.cast?.characters ?? []).flatMap(c => c.propStem ? [c.propStem] : []))
    switch (step) {
        case 'songStyle': return existsSync(join(dir, 'input', 'idea.txt'))
        case 'stems': case 'transcript': case 'lyricsTiming': return config.alignLyrics
        case 'instrumentStems': return config.alignLyrics && (props.has('guitar') || props.has('piano'))
        case 'propActivity': return config.alignLyrics && props.size > 0
        case 'singing': return config.singers.length > 0
        case 'shotViews': return config.sequenceSheets && config.locationView === 'auto'
        // made only when the shots are planned: shots planned before the step existed stay without it
        case 'blocking': return data.blocking !== undefined || data.shotMoments === undefined
        case 'characterLookVariants': case 'characterDescriptionVariants': return (data.cast?.characters ?? []).some(c => c.isGroup && !c.alike)
        default: return true
    }
}

