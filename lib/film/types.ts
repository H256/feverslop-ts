import type {CastingCopies} from "../casting.ts";
import type {Partials} from "../partials.ts";

// Data of the short-film pipeline (film.ts) - lives in films/<id>/project.json, separate from the music-video projects.

// How a film starts: from a story idea the pipeline develops into a screenplay, or from a screenplay it adopts
export type FilmMode = 'idea' | 'screenplay'

export type Brief = {
    mode: FilmMode,
    title: string,
    language: string,               // ISO 639-1 code of the dialogue - an idea is told in it, a screenplay is written in it
    logline: string,                // one sentence: who wants what, and what stands in the way
    genre: string,
    tone: string,
    setting: string,                // era and place
}

export type OutlineScene = {
    heading: string,                // "INT. KITCHEN - NIGHT"
    characters: string[],           // names as they will appear in the script
    summary: string,
    purpose: string,                // what the scene changes in the story
    seconds: number,                // planned screen time
    begins?: string,                // where everybody is and in what state at the start (bound or free, hurt, what they hold or wear) and the time of day - what the scene before left
    changes?: string,               // what happens on screen that changes a state (someone freed, something picked up, someone hurt, a move), or "nothing"
}
export type Outline = {
    characters: { name: string, role: string, appearance: string, voice: string }[],
    scenes: OutlineScene[],
    // what has to be shown earlier for a later event to be believable: {event: "Leo breaks free in scene 12", setup: "the rope rots - shown in scenes 4 and 9"}
    setups?: { event: string, setup: string }[],
}

// kind: spoken = the character is on screen and speaks, offscreen = heard but out of frame,
// voiceover = narration or thoughts, lips closed
// which way a person's face is turned in the picture: toward the left or the right of the frame, into the lens, or the back to the camera
export type Facing = 'left' | 'right' | 'camera' | 'away'

export type DialogueKind = 'spoken' | 'offscreen' | 'voiceover'

export type ScreenplayElement =
    | { type: 'action', text: string }
    | {
        type: 'dialogue',
        speaker: string,            // as written in the script (the cue) - cast.characters[].aliases resolves it
        text: string,               // verbatim, in its own language - never translated or rewritten
        kind: DialogueKind,
        delivery?: string,          // the parenthetical: "whispering", "out of breath"
        language?: string,          // only when it differs from Screenplay.language
        translation?: string,       // a translation the screenplay itself has under the line (in brackets) - not spoken, it becomes the subtitle
    }

export type Scene = {
    id: string,                     // s1, s2, ...
    setting: 'INT' | 'EXT' | 'INT/EXT',
    location: string,               // as written in the slugline
    time: string,                   // DAY, NIGHT, DUSK, ...
    shot?: string,                  // the script's own heading when it names a shot or a view ("CLOSE UP - HIS FACE") - the writer's wish for the framing
    elements: ScreenplayElement[],
}

export type Screenplay = {
    title: string,
    language: string,
    scenes: Scene[],
}

// What the screenplay needs to be filmed: who is in it, where it takes place. Characters and locations get a
// reference picture later, voice-only characters (a narrator) don't.
export type FilmCharacter = {
    id: string,
    name: string,
    aliases: string[],              // every cue and name the script uses for them
    role: string,
    appearance: string,             // concrete and visible: age, build, face, hair, clothing
    voice: string,                  // for the video model: gender, age, pitch, timbre, pace, accent
    voiceOnly?: boolean,            // never on screen - a narrator
    states?: FilmCharacterState[],  // other looks of the character that last for a stretch of the film (wounded, disguised) - each has a reference picture of its own
}
// id: slug, unique among the character's states. change: what is different from the normal look, in plain visible terms
// from: the number of the scene (1 = the first) in which the script first shows the look - the shot planning cannot use it before
export type FilmCharacterState = { id: string, name: string, change: string, from?: number }
// one view of a place on its reference sheet: name = where the camera stands and what it looks toward (short), shows = what is seen from there
export type LocationView = { name: string, shows: string }
export type FilmLocation = {
    id: string,
    name: string,
    aliases: string[],              // the names the sluglines use
    description: string,
}
export type FilmCast = { characters: FilmCharacter[], locations: FilmLocation[] }

// One shot of a scene: what the camera sees and which dialogue lines are spoken in it. A shot is the unit that is
// never split - it lives in one clip, with its lines.
export type Shot = {
    framing: string,                // "medium close-up"
    camera: string,                 // "the camera pushes in slowly"
    characters: string[],           // ids of the characters who are in the picture
    action: string,                 // what is visible, characters by their exact names - the dialogue itself is not in it
    lines: number[],                // the dialogue lines spoken in it: indexes into the scene's dialogue elements, in order
    seconds: number,                // planned length, at least the time to speak its lines
    view?: string,                  // where the camera is in the place and what it looks toward, in the terms of the scene's layout
    people?: Record<string, { state?: string, frame?: string, motion?: string, facing?: Facing, foreground?: boolean }>, // per character in the shot: state = what they do/hold/wear and where they are at the START of the shot, frame = how they are in the picture (sharp or soft, where, from which side), motion = what moves during the shot
    cutaway?: boolean,              // the picture shows hands, an object or a place while a line is heard: the speaker is not in it, the line is spoken off-screen
    hold?: boolean,                 // a held shot: the camera and everybody stay where they are, only faces and mouths move (a talking close-up) - the prompt says how the picture stays
    placeView?: number,             // 1-5: which view of the location's reference sheet is the background of this shot
    states?: Record<string, string>,// character id -> state id, for a character who is in one of their other looks in this shot (left out = the normal look)
    texts?: string[],               // only when a line is too long for one clip: the part of it (same order as lines) spoken in this shot - the parts of a line, joined, are the line
    deliveries?: string[],          // how each of its lines is spoken (same order as lines): feeling, intensity, pace - where the script has no parenthetical
    continues?: boolean,            // the shot goes on in the same take as the one before, no cut
}
// staging: the fixed physical arrangement of the scene - where everyone is, in what posture, what they wear and hold - which every shot keeps to
// people / voices: what the shot planning read in the script of the scene - is anyone in it (a character, a creature, people said in general
// words), does the script itself have voices in it that are not numbered lines (whispers, a chant, a spell). Not set in a plan made before.
// ends: where everybody is and what they hold when the scene is over, by character id - the next scene starts from it
export type SceneCoverage = { sceneId: string, soundscape: string, staging?: string, ends?: Record<string, string>, people?: boolean, voices?: boolean, fast?: boolean, shots: Shot[] }

export type FilmProject = {
    inputs?: Record<string, string>,    // fingerprints of the input files and settings - not a step
    partials?: Partials,                // answers of a running step, one per element (lib/partials.ts) - not a step
    brief?: Brief,
    outline?: Outline,                  // idea mode only
    screenplay?: Screenplay,
    cast?: FilmCast,
    summary?: string,
    lookBrief?: string,
    characterLooks?: Record<string, string>,         // Krea 2 prompt of the reference picture, per character id (never a voice-only one)
    characterDescriptions?: Record<string, string>,  // the look without the picture's pose, background and light - for the clip prompts
    locationLooks?: Record<string, string>,
    locationDescriptions?: Record<string, string>,
    scriptFixes?: { scene: string, before: string, after: string }[], // what the script repair changed (action lines and times of day, never dialogue) - the repair is done once for a script of the pipeline's own
    locationViews?: Record<string, LocationView[]>,  // per location id: the five views of its reference sheet, the first is the picture itself - only with sequence sheets
    scriptNotes?: string[],             // contradictions the script has in itself (a person bound, then free, then bound again) - read by the language model, only reported
    subtitles?: Record<string, string>, // config subtitles = a language code: the translation of every line spoken in another language, by "sceneId:line" (line = index among the dialogue lines of the scene)
    coverage?: SceneCoverage[],         // the shots of every scene, in scene order
    castingCopies?: CastingCopies,      // the library assets copied for casting.json, and which version - not a step (lib/casting.ts)
    // without designed views (locationViews): what each view of a place's rendered sheet shows, read from its frames by a vision
    // model, by location id, with the fingerprint of the frames it was read from - and the view each shot of a scene is in (1-based),
    // with the fingerprint of what it was chosen from. Not steps: made again when their sheet or their shots change (lib/film/views.ts)
    sheetViews?: Record<string, { fingerprint: string, views: LocationView[] }>,
    shotViews?: Record<string, { fingerprint: string, views: number[] }>,
}
