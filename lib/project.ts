import {existsSync} from "node:fs";
import {join} from "node:path";
import {log, styles} from "./log.ts";

export type Character = { id: string, name: string, role: string }
export type Location = { id: string, name: string }

// A story beat has no timing - it is stretched onto the music later
export type StoryBeat = {
    id: string,
    order: number,
    summary: string,
    moments: string[],              // what visibly happens, in order - spread over the beat's clips and shots
    locationId: string,
    characterIds: string[],
    intensity: number,              // 0-1, matched against the music energy
    weight: number,                 // relative screen time
    kind: 'establish' | 'build' | 'hit' | 'release',
    lyricAnchor?: string,           // song section label this beat should play under
    stateAfter: string[],           // continuity facts that are true after this beat
}

export type LyricSection = { label: string, lines: string[] }

export type MusicSection = { label: string, start: number, end: number, energy: number }
export type MusicMap = {
    bpm: number,
    durationSec: number,
    downbeats: number[],
    barEnergy: number[],
    sections: MusicSection[],
}

// One slot = one generated video clip, cut on downbeats
export type Slot = {
    id: string,
    index: number,
    section: string,
    start: number,
    end: number,
    bars: number,
    energy: number,
    lyrics: string[],               // approximate: section lines spread over its slots
    vocals?: SlotVocal[],           // real timing, only when the lyrics are aligned
}
export type Timeline = {
    maxClipSec: number,
    barsPerSlot: number,
    aligned: boolean,               // built with the lyrics timing
    sections: MusicSection[],       // the sections the slots were cut from - refined by the lyrics timing if aligned
    slots: Slot[],
}

// Stems of the song, paths relative to the project folder
export type Stems = Record<'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other', string>

// Whisper's words on the vocals stem
export type TranscriptWord = { text: string, start: number, end: number, probability: number }
export type Transcript = { words: TranscriptWord[] }

export type TimedWord = { text: string, start: number, end: number }
// One sung line of lyrics.txt with its real timing. `line` numbers the sung lines (performance notes excluded)
export type TimedLine = {
    line: number,
    sectionIndex: number,
    section: string,
    text: string,
    start: number,
    end: number,
    words: TimedWord[],
    confidence: number,             // 0-1, the share of the line's words found in the transcript
}
export type LyricsTiming = { lines: TimedLine[] }

// The part of a sung line inside one clip, times relative to the clip's first frame
export type SlotVocal = { line: number, text: string, start: number, end: number, words: TimedWord[] }

// Who sings: character ids, and per sung line (numbered like TimedLine.line) the singer(s)
export type Singing = { singers: string[], lines: { line: number, text: string, singers: string[] }[] }

export type Assignment = { slotId: string, beatId: string }

export type Project = {
    inputs?: Record<string, string>, // fingerprints of the input files and settings - not a step
    music?: MusicMap,
    stems?: Stems,
    transcript?: Transcript,
    lyricsTiming?: LyricsTiming,
    story?: string,
    summary?: string,
    cast?: { characters: Character[], locations: Location[] },
    singing?: Singing,
    lookBrief?: string,
    characterLooks?: Record<string, string>,
    locationLooks?: Record<string, string>,
    characterDescriptions?: Record<string, string>,   // the looks without the picture, for the clip prompts
    locationDescriptions?: Record<string, string>,
    beats?: StoryBeat[],
    timeline?: Timeline,
    mapping?: Assignment[],
}
export type StepName = Exclude<keyof Project, 'inputs'>

// Which steps a step reads from - redoing a step also redoes everything built on it
const dependsOn: Record<StepName, StepName[]> = {
    music: [],
    stems: [],
    transcript: ['stems'],
    lyricsTiming: ['transcript'],
    story: [],
    summary: ['story'],
    cast: ['story'],
    singing: ['cast'],
    lookBrief: ['summary'],
    characterLooks: ['cast', 'lookBrief'],
    locationLooks: ['cast', 'lookBrief', 'summary'],
    characterDescriptions: ['characterLooks'],
    locationDescriptions: ['locationLooks'],
    beats: ['story', 'cast', 'singing'],
    timeline: ['music', 'lyricsTiming'],
    mapping: ['beats', 'timeline'],
}

export class ProjectStore {
    readonly dir: string
    readonly file: string
    data: Project = {}

    constructor(readonly id: string) {
        this.dir = join('projects', id)
        this.file = join(this.dir, 'project.json')
    }

    input(name: string) {
        return join(this.dir, 'input', name)
    }

    async load() {
        if (existsSync(this.file)) this.data = await Bun.file(this.file).json()
    }

    async save() {
        await Bun.write(this.file, JSON.stringify(this.data, null, 2))
    }

    invalidate(name: StepName) {
        if (this.data[name] !== undefined) log.step('Redo', styles.name(name))
        delete this.data[name]
        for (const [step, deps] of Object.entries(dependsOn) as [StepName, StepName[]][]) {
            if (deps.includes(name) && this.data[step] !== undefined) this.invalidate(step)
        }
    }

    /**
     * Redoes the steps built on an input that changed since the last run. Every input is fingerprinted in
     * project.json; `assumed` is the value an input had before fingerprints existed (else it counts as unchanged).
     */
    async syncInputs(inputs: Record<string, { value: string | Uint8Array, steps: StepName[], assumed?: string }>) {
        const previous = this.data.inputs ?? {}
        const current: Record<string, string> = {}
        const hash = (value: string | Uint8Array) => Bun.hash(value).toString(16)
        const hasSteps = Object.keys(this.data).some(key => key !== 'inputs')
        for (const [name, {value, steps, assumed}] of Object.entries(inputs)) {
            current[name] = hash(value)
            const before = previous[name] ?? (assumed !== undefined && hasSteps ? hash(assumed) : current[name])
            if (before !== current[name]) {
                log.step('Changed', `${styles.name(name)} ${styles.muted(`- redoing ${steps.join(', ')}`)}`)
                for (const step of steps) this.invalidate(step)
            }
        }
        if (JSON.stringify(current) !== JSON.stringify(previous)) {
            this.data.inputs = current
            await this.save()
        }
    }

    // Runs a step unless its result is already in project.json
    async step<K extends StepName>(name: K, title: string, run: () => Promise<NonNullable<Project[K]>>): Promise<NonNullable<Project[K]>> {
        log.section(title)
        const cached = this.data[name]
        if (cached !== undefined) {
            log.step('Cached', styles.muted(`from ${this.file} - use --redo=${name} to regenerate`))
            return cached as NonNullable<Project[K]>
        }
        const result = await run()
        this.data[name] = result
        await this.save()
        return result
    }
}
