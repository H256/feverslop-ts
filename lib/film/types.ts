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
}
export type Outline = {
    characters: { name: string, role: string, appearance: string, voice: string }[],
    scenes: OutlineScene[],
}

// kind: spoken = the character is on screen and speaks, offscreen = heard but out of frame,
// voiceover = narration or thoughts, lips closed
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
}
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
    texts?: string[],               // only when a line is too long for one clip: the part of it (same order as lines) spoken in this shot - the parts of a line, joined, are the line
    deliveries?: string[],          // how each of its lines is spoken (same order as lines): feeling, intensity, pace - where the script has no parenthetical
    continues?: boolean,            // the shot goes on in the same take as the one before, no cut
}
// staging: the fixed physical arrangement of the scene - where everyone is, in what posture, what they wear and hold - which every shot keeps to
// people / voices: what the shot planning read in the script of the scene - is anyone in it (a character, a creature, people said in general
// words), does the script itself have voices in it that are not numbered lines (whispers, a chant, a spell). Not set in a plan made before.
export type SceneCoverage = { sceneId: string, soundscape: string, staging?: string, people?: boolean, voices?: boolean, fast?: boolean, shots: Shot[] }

export type FilmProject = {
    inputs?: Record<string, string>,    // fingerprints of the input files and settings - not a step
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
    subtitles?: Record<string, string>, // config subtitles = a language code: the translation of every line spoken in another language, by "sceneId:line" (line = index among the dialogue lines of the scene)
    coverage?: SceneCoverage[],         // the shots of every scene, in scene order
}
