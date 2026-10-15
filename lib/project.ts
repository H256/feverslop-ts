import {existsSync, renameSync} from "node:fs";
import {join} from "node:path";
import {log, styles} from "./log.ts";

// prop: a distinctive physical object the character carries/uses throughout the story (weapon, tool, instrument, ...)
// propStem: only set when the prop is a musical instrument audible in the song - which stem its sound belongs to,
// so its on-screen use can be grounded in real audio activity instead of playing continuously in every shot.
// "guitar"/"piano" come from a separate htdemucs_6s pass (lib/music.ts separateInstrumentStems) - htdemucs_ft's
// main 4-stem separation (cleanest for vocals) folds both into "other", too coarse to time a guitar's own entry
export type PropStem = 'drums' | 'bass' | 'other' | 'guitar' | 'piano'
// isGroup: a collective cast entry acting as one individual member of the group (e.g. "Orcs", "Miners") rather
// than a single person - see computeMemberCounts in lib/compose.ts for how this turns into several distinct
// reference images so every member on screen doesn't look identical throughout the video.
// alike: the members of the group look alike - a species, a pack of one kind of creature, a unit in the same uniform -
// so the group has one look and no member variants (a group of recognizably different individuals has them)
export type Character = { id: string, name: string, role: string, prop?: string, propStem?: PropStem, isGroup?: boolean, alike?: boolean }
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
    lyricAnchor?: string,           // old projects only - beats follow the song's time, not its sections
    stateAfter: string[],           // continuity facts that are true after this beat
    // the beat is one unbroken take: each of its clips goes on from the last frame of the one before, with no cut between
    // them (config.continuity). Without it - the default - every clip of the beat is its own cut
    continuous?: boolean,
    // for a group character (Character.isGroup) in characterIds: how many distinct individuals of that group are
    // visible together on screen during this beat - drives how many member variant images are worth generating
    groupSize?: Record<string, number>,
}

// One shot as the planner staged it (step 11b): the action, who is in the picture and where/how each of them is. Names are
// resolved to character ids when the plan is read (lib/shot-plan.ts). Everything but the action is optional - a plan from
// before this existed has only actions.
export type ShotPlan = {
    action: string,
    framing?: string,
    camera?: string,
    view?: string,                  // where the camera stands and what it looks toward, in terms of the staging
    hold?: boolean,                 // nobody moves and the camera does not: same framing from the first frame to the last
    characters?: string[],          // ids of everyone visible in the shot
    people?: Record<string, { state?: string, frame?: string, motion?: string }>,
    rest?: string,                  // what everyone in the shot who has no entry of their own does at the same time, each in their own way
}
// A beat's shots: the fixed layout of the place, where everybody is when the beat is over (the next beat starts from it)
export type BeatShots = { staging?: string, ends?: Record<string, string>, shots: ShotPlan[] }

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
    micro?: boolean,                // a piece of a fight clip (config.fightClips): one shot, only its own people as references
}
export type Timeline = {
    maxClipSec: number,
    barsPerSlot: number,
    aligned: boolean,               // built with the lyrics timing
    sections: MusicSection[],       // the sections the slots were cut from - refined by the lyrics timing if aligned
    slots: Slot[],
}

// Stems of the song, paths relative to the project folder
export type Stems = Record<'vocals' | 'drums' | 'bass' | 'other', string>
// The htdemucs_6s guitar/piano stems - separated on top of Stems above, only for propStems that actually need them
export type InstrumentStems = Partial<Record<'guitar' | 'piano', string>>

// RMS-energy activity ranges per stem (same method as Transcript.activity, generalized to any stem) - only the
// stems actually claimed by a character's propStem are analyzed
export type PropActivity = Partial<Record<PropStem, { start: number, end: number }[]>>

// Whisper's words on the vocals stem
export type TranscriptWord = { text: string, start: number, end: number, probability: number }
// activity: RMS-energy vocal activity ranges from the vocals stem, independent of whisper - grounds interpolated
// (unheard) word timing in real acoustic evidence instead of spreading them blindly across a whole gap
export type Transcript = { words: TranscriptWord[], activity?: { start: number, end: number }[] }

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
    adlib?: boolean,                // not in lyrics.txt - sung words whisper heard on top of it (confidence: whisper's own)
}
export type LyricsTiming = { lines: TimedLine[] }

// The part of a sung line inside one clip, times relative to the clip's first frame
export type SlotVocal = { line: number, text: string, start: number, end: number, words: TimedWord[] }

// Who sings: character ids, and per sung line (numbered like TimedLine.line) the singer(s)
export type Singing = { singers: string[], lines: { line: number, text: string, singers: string[] }[] }

export type Assignment = { slotId: string, beatId: string }

export type Project = {
    inputs?: Record<string, string>, // fingerprints of the input files and settings - not a step
    // The YuE2 style/tags prompt written for lyrics.txt (music-style.txt is the optional direction hint for it) -
    // lyrics.txt itself isn't cached here, it's a plain input file like story-idea.txt, generated once into
    // existence and then treated as fixed (delete it, or edit it, to get a new one - see index.ts)
    songStyle?: string,
    music?: MusicMap,
    stems?: Stems,
    instrumentStems?: InstrumentStems,   // guitar/piano, separated once cast.characters' propStems are known
    transcript?: Transcript,
    lyricsTiming?: LyricsTiming,
    story?: string,
    summary?: string,
    cast?: { characters: Character[], locations: Location[] },
    singing?: Singing,
    lookBrief?: string,
    characterLooks?: Record<string, string>,
    // group characters only (Character.isGroup with more than one member visible at once, see computeMemberCounts):
    // one look prompt per member, index 0 is always the same text as characterLooks[id]
    characterLookVariants?: Record<string, string[]>,
    // the characterLookVariants without the reference sheet, one per member (see characterDescriptions) - every
    // member has its own look, so it needs its own description too: reusing the group's shared characterDescriptions
    // entry for every member described a different-looking anchor image with the wrong member's text, which read
    // as the video model fighting itself and drifting the whole member toward whichever member the text described
    characterDescriptionVariants?: Record<string, string[]>,
    locationLooks?: Record<string, string>,
    characterDescriptions?: Record<string, string>,   // the looks without the picture, for the clip prompts
    locationDescriptions?: Record<string, string>,
    beats?: StoryBeat[],
    timeline?: Timeline,
    mapping?: Assignment[],
    propActivity?: PropActivity,
    shotViews?: Record<string, number[]>,   // beatId -> per shot of the beat the view of the place's sheet (0-4, LOCATION_VIEWS) the shot is in - only with config.locationView "auto"
    shotMoments?: Record<string, BeatShots | string[]>,   // beatId -> the staged shots of the beat, replacing beat.moments when not --legacy-moments (string[]: a plan from before the staging)
}
export type StepName = Exclude<keyof Project, 'inputs'>

// Which steps a step reads from - redoing a step also redoes everything built on it
const dependsOn: Record<StepName, StepName[]> = {
    songStyle: [],
    music: [],
    stems: [],
    instrumentStems: ['stems', 'cast'],
    transcript: ['stems'],
    lyricsTiming: ['transcript', 'music'],
    story: [],
    summary: ['story'],
    cast: ['story'],
    singing: ['cast'],
    lookBrief: ['summary'],
    characterLooks: ['cast', 'lookBrief'],
    characterLookVariants: ['characterLooks', 'beats'],
    characterDescriptionVariants: ['characterLookVariants', 'characterDescriptions'],
    locationLooks: ['cast', 'lookBrief', 'summary'],
    characterDescriptions: ['characterLooks'],
    locationDescriptions: ['locationLooks'],
    beats: ['story', 'cast', 'singing', 'music', 'lyricsTiming'],
    timeline: ['music', 'lyricsTiming'],
    mapping: ['beats', 'timeline'],
    propActivity: ['stems', 'instrumentStems', 'cast'],
    shotMoments: ['beats', 'timeline', 'mapping', 'propActivity', 'singing'],
    shotViews: ['shotMoments'],
}

export const STEP_NAMES = Object.keys(dependsOn) as StepName[]

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
        if (!existsSync(this.file)) return
        try {
            this.data = await Bun.file(this.file).json()
        } catch (e) {
            throw new Error(`${this.file} is not valid JSON (${e instanceof Error ? e.message : String(e)}) - fix it by hand, or delete it to start over (every step is generated again)`)
        }
        if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) throw new Error(`${this.file} must be a JSON object - fix it by hand, or delete it to start over (every step is generated again)`)
    }

    // written next to the target first, so a crash mid-write never leaves a truncated project.json
    async save() {
        // the process id in the name: two runs saving at once never write into the same temporary file
        const partial = `${this.file}.${process.pid}.partial`
        await Bun.write(partial, JSON.stringify(this.data, null, 2))
        renameSync(partial, this.file)
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
