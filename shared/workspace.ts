/**
 * Browser-safe wire contracts of the workspace: what the editor server sends and accepts as JSON. No runtime imports, nothing
 * from the pipeline - the server modules re-export these, so a change on either side is a type error on the other.
 */

export type ProjectKind = 'music' | 'film'
export type Media = {file: string, v: number}
export type PlanStage = 'story' | 'cast' | 'look' | 'plan'
export type Freshness = 'pinned' | 'current' | 'stale'
export type FinalState = 'missing' | 'current' | 'older'
export type RunState = 'running' | 'stopped' | 'failed' | 'finished'
export type Explained = {text: string, action: string}
export type LastRun = {state: RunState, command: string, startedAt: string, failures: string[], explained: Explained[]}
export type AssetKind = 'character' | 'location'
export type ElementKind = AssetKind

////////// THE START PAGE AND THE LIBRARY
export type ProjectListing = {
  id: string, kind: ProjectKind, title: string, group: string,
  clips: number, rendered: number, pictures: number, changed: number,
  final: FinalState, thumb?: Media,
  stage?: PlanStage,          // a project without clips yet: how far its plan is
  lastRun?: LastRun,
}
export type LibraryEntry = {
  kind: AssetKind, id: string, name: string, description: string,
  anchors?: string, source?: string, created?: string,
  picture?: Media, anchor?: Media, video?: Media, frames: Media[],
  usedBy: {kind: ProjectKind, id: string, role: string}[],
}
export type Library = {dir: string, assets: LibraryEntry[]}
export type EditorServer = {name: string, reachable: boolean, running: number, pending: number, device?: string, freeGb?: number, totalGb?: number}

////////// A PROJECT
export type EditorPerson = {name: string, text: string}
export type EditorShot = {label: string, at: number, framing: string, camera: string, subjects: string[], action?: string, people: EditorPerson[]}
// a sung or spoken line: seconds from the clip's start
export type EditorLine = {at: number, end?: number, text: string, who: string, line?: number}
export type EditorPicture = {id: string, label: string, file: string, kind: string, name: string, subject: string, description: string, exists: boolean, v?: number}
export type EditorMark = {kind: 'failed' | 'backdrop' | 'backdrop-attempt' | 'older-start' | 'dropped', text: string}
// a film: the views of its place the clip can be given, and the one it has
export type EditorViews = {locationId: string, chosen?: number, options: {n: number, name: string, shows: string, file: string, v?: number}[]}
export type EditorOverride = {placeView?: number, order?: string[], without?: string[]}
export type EditorClip = {
  id: string,
  frameStart: number,
  frames: number,
  start: number,              // seconds on the whole video's timeline
  end: number,
  group: string,              // the section of a song, the scene of a film
  context: {label: string, text?: string, staging?: string},    // the beat or scene it comes from
  startsFrom?: string,
  next?: string,              // the clip that goes on from this one
  prompt: string,
  shots: EditorShot[],
  lines: EditorLine[],
  pictures: EditorPicture[],
  audio: {label: string, stem?: string, songStart: number, songEnd: number}[],
  dropped: string[],
  video?: {file: string, v: number, workflow?: string, size?: string, seed?: number, renderedFrames?: number},
  firstFrame?: Media,
  lastFrame?: Media,
  marks: EditorMark[],
  views?: EditorViews,
  override?: EditorOverride,
  preview?: {file: string, v: number, approximate?: boolean},
  refined: {variant: string, file: string, v: number, size?: string, seed?: number, denoise?: number}[],     // larger versions of it (bun run refinish)
}
export type EditorGroup = {id: string, label: string, start: number, end: number}
export type EditorFinal = {file: string, v: number, label: string, state: FinalState, preview: boolean, width?: number, height?: number, fps?: number}
export type EditorProject = {
  id: string,
  kind: ProjectKind,
  title: string,
  fps: number,
  seconds: number,
  bpm?: number,
  song?: Media,               // what plays under the whole video: only when the final video has it too
  groups: EditorGroup[],
  clips: EditorClip[],
  pictures: {id: string, kind: string, name: string, file: string, exists: boolean, v?: number}[],
  final: {state: FinalState, file?: string, v?: number},
  previewVideo?: Media,
  refinedVariants: string[],
  finals: EditorFinal[],      // every finished video there is of it: the final one, finished, at another frame rate
  lastRun?: LastRun,
  command: string,            // how this project is run, for the commands the page shows
  sings?: boolean,            // someone sings: who sings which line can be changed (the Singers page)
  plan: {stage?: PlanStage, next?: PlanStage},  // how far the plan is: the last stage it has, the one a plan run makes next
  timed?: boolean,            // the lyrics are aligned: when they are sung can be changed (the Timing page)
}
export type EditorFreshness = {clips: Record<string, Freshness>, pictures: Record<string, Freshness>}
/** What `bun run status` says of a project, as far as the page shows it. */
export type ProjectStatus = {
  steps: unknown, changed: unknown,
  pictures: {total: number, missing: number, stale: number},
  clips: {total: number, missing: number, stale: number},
  final: FinalState,
  next: {command?: string, why: string, estimate?: string},
}
/** The overview only reads these fields of a status. */
export type ListingStatus = Pick<ProjectStatus, 'clips' | 'pictures' | 'next'>
export type ClipProgress = 'waiting' | 'rendering' | 'done'
export type RunProgress = {clips: Record<string, ClipProgress>, done: number, total: number}
export type Estimate = {estimate: string, risks?: string[], fixedSeed?: number}

////////// VERSIONS - what was put away when something was made again
export type ClipVersion = {
  id: string,                             // what to ask for it by: its place, relative to the project
  video: string,
  firstFrame?: string,
  lastFrame?: string,
  source: 'again' | 'stale' | 'leak',     // why it was put away: rendered again on request, from an older plan, a grey backdrop
  made: number,                           // when it was rendered: the time of its file
  seed?: number,
  workflow?: string,
  size?: string,
  fingerprint?: string,
}
export type ClipVersionView = ClipVersion & {v: number, fromThisPlan?: boolean}

////////// THE REFERENCES
export type EditorReference = {
  id: string, kind: 'character' | 'location' | 'prop', name: string, prompt: string, description: string,
  file: string, picture?: Media, anchor?: Media, video?: Media,
  frames: Media[],
  hasSheet: boolean,
  look?: {base: string, change: string},
  looks: string[],            // its other looks: drawn from its anchor, so a new anchor makes them stale
  library?: string,           // played by this asset of the library (casting.json): it is not rendered here
  clips: string[],
  versions: {id: string, picture: Media, anchor?: Media, video?: Media, source: string, made: number, seed?: number, prompt?: string, fingerprint?: string}[],
  readsViews: boolean,        // a film's place without designed views: a new sheet is read again by the vision model
}

////////// THE PREPRODUCTION
export type BookView = {
  text?: string,              // the story; a film: its screenplay as a script reads
  editable: boolean,          // a music video's story is one text; a film's screenplay is changed in its script or in project.json
  builtOn: string[],          // the steps that go when it is changed
  stage?: PlanStage,
  next?: PlanStage,
  proposal?: string,          // the story written anew for the cast as it is now, waiting to be taken or dropped
  keptByCast: string[],       // what goes when it is told anew for the same cast: the summary and the plan from the beats on
}
export type StoryResult = {changed: boolean, dropped: string[]}
export type StoryForCast = {proposal?: boolean, renamed?: {from: string, to: string}[]}

export type CastMember = {
  id: string, name: string,
  role?: string,              // characters: who they are in the story
  prop?: string,              // music video characters: the thing they carry or play
  appearance?: string,        // film characters: what they look like, as the script says it
  voice?: string,             // film characters: how they sound
  voiceOnly?: boolean,        // film characters: never on screen
  description?: string,       // film places
  group?: boolean,            // music video: a group character - shown, its members are not changed here
}
export type CastView = {
  characters: CastMember[],
  locations: CastMember[],
  canAdd: boolean,            // a music video's cast comes from its story and can grow; a film's is the script's
  builtOn: string[],          // the steps that go when the cast is changed: planned again by the next plan run
  remakes: string[],          // the steps written again only for whoever is new or changed (a music video's looks): the others keep theirs
  stage?: PlanStage,
}
export type CastChange = {characters: (Partial<CastMember> & {name: string})[], locations: (Partial<CastMember> & {name: string})[]}
// dropped: steps gone as a whole; remade: steps made again for some of their elements, "step: id, id"
// renamed: who kept their id and got another name - the story still says the old one
export type CastResult = {changed: boolean, dropped: string[], remade: string[], added: string[], removed: string[], renamed: {from: string, to: string}[]}

export type CastingRole = {
  kind: AssetKind, id: string, name: string, role?: string,
  entry?: string,             // what casting.json says; none: it runs as "project:"
  libraryId?: string,
  copied: boolean,            // the library asset is in the project already
  picture?: Media,
  clips: string[],            // the clips that have its picture
  errors: string[],
  warnings: string[],
}
export type CastingView = {roles: CastingRole[], errors: string[], warnings: string[], options: Record<AssetKind, string[]>}
export type CastingRedo = {
  changes: string[],          // what casting.json says now that the project does not have yet, in words
  redo: string[],             // the --redo that makes what was planned from the old texts again; none: nothing was planned from them
}

export type LookField = 'look' | 'description' | 'anchors' | 'layout'
export type LookElement = {
  kind: ElementKind, id: string, name: string,
  library?: string,           // played by a library asset: its texts are the library's, changed there
  look?: string,              // the prompt of its reference picture
  description?: string,       // the look without the picture's pose, background and light - what the clip prompts say of it
  anchors?: string,           // music video places: the fixed features kept behind the people of every shot
  layout?: string,            // music video places: the floor plan every beat there is staged in
}
export type LookView = {
  lookBrief?: string,
  characters: LookElement[],
  locations: LookElement[],
  briefBuiltOn: string[],     // what goes when the look of the whole is changed
  builtOn: string[],          // what goes as a whole when the look of one character or place changes
  stage?: PlanStage,
}
export type LookChange = {
  lookBrief?: string,
  elements?: ({kind: ElementKind, id: string} & Partial<Record<LookField, string>>)[],
  again?: {kind: ElementKind, id: string}[],      // written anew by the language model, with everything written from it
}
export type LookResult = {changed: boolean, dropped: string[], remade: string[]}

////////// WHO SINGS, AND WHEN
export type SingingPart = {from: number, singers: string[]}
export type SingingLine = {
  line: number,
  text: string,
  section?: string,
  start?: number,             // seconds in the song
  end?: number,
  singers: string[],
  parts?: SingingPart[],      // the singer changes within the line: from word n on
  words: {text: string, start: number, end: number}[],  // the line's words with their song times - where a part can start
  estimated: boolean,         // the times are barely found in the transcript, only spread over the line: a split can be off
  beats: string[],            // the beats of the clips it is sung in
  clips: string[],
}
export type SingingCharacter = {id: string, name: string, role?: string, picture?: Media, beats: string[], clips: string[]}
export type SingingView = {
  singers: string[],          // the singers of the song, the lead first
  lines: SingingLine[],
  characters: SingingCharacter[],
  beats: {id: string, characterIds: string[], planned: boolean, clips: string[]}[],
  unplanned: string[],        // beats without a shot plan: the next plan run plans them
  audio?: Media,              // what to listen to a line in: the vocals stem, else the song
}
// a line is sung by `singers` as a whole, or with `parts` by each part's singers from its word on (singers is then ignored)
export type SingingChange = {lines: {line: number, singers: string[], parts?: SingingPart[]}[]}
export type SingingResult = {
  changed: number[],          // the lines that changed
  replanned: string[],        // the beats that lost their shot plan
  added: {beat: string, character: string}[],   // singers who were not in the beat and are now
  newSingers: string[],       // sing now and did not before: every clip they are in changes
  formerSingers: string[],    // sang before and no longer do: the same
  staleClips: string[],
}

export type TimingWord = {text: string, start: number, end: number}
export type TimingLine = {
  line: number,
  section: string,
  text: string,
  words: TimingWord[],
  estimated: boolean,         // the times are a guess: barely found in the transcript
  byHand: boolean,            // placed on this page
  beats: string[],            // the beats of the clips it is sung in
}
export type TimingView = {
  duration: number,
  lines: TimingLine[],
  cuts: {id: string, start: number, end: number, beat?: string}[],   // the clips of the song as the plan cut it
  beats: {id: string, planned: boolean, clips: string[]}[],
  unplanned: string[],
  audio?: Media,              // the vocals stem, else the song
}
export type TimingChange = {lines: {line: number, words: {start: number, end: number}[]}[]}
export type TimingResult = {
  changed: number[],          // the lines that moved
  slots: string[],            // the clips of the cut whose vocals changed
  replanned: string[],        // the beats that lost their shot plan
  staleClips: string[],
  crossing: {line: number, word: string, cut: number}[],    // words a cut falls into now: cutting the song again helps
}

////////// RUNS
/** What the page may ask a run for. The server adds what only it sets (a picture's edited prompt, the look stage). */
export type RunRequest =
  | {type: 'clips', ids: string[], again?: boolean, preview?: boolean}
  | {type: 'look-pictures'}
  | {type: 'adapt-story'}
  | {type: 'final', preview?: boolean}
  | {type: 'plan', until?: string, redo?: string[]}
  | {type: 'refresh', what: ('pictures' | 'clips')[]}
  | {type: 'retake', clip: string, range: string}
  | {type: 'repeat', command: string}
  | {type: 'next', command: string}
  | {type: 'leak-scan'}
  | {type: 'export-asset', asset: string, as?: string}
  | {type: 'add-view', location: string, name: string, shows: string}
  | {type: 'refinish', preset?: string, upscale?: string, size?: string, denoise?: number, fps?: number, finish?: boolean, only?: string[]}
export type RunInfo = {
  source: 'here' | 'terminal',
  command: string,
  pid: number,
  startedAt: string,
  running: boolean,
  code?: number,
}
/** The server-sent events of a run: its log lines from a cursor on, and its state when it changes. */
export type RunLines = {lines: string[], next: number}

////////// THE SETTINGS OF A PROJECT (config.json)
/** One setting of a project as the page edits it: what it is called, how it is chosen, and what it says. */
export type SettingView = {
    key: string, label: string, group: 'Workflows' | 'Size' | 'Continuing clips' | 'Seed and retries' | 'Final video',
    /** select: one of `choices`; text: a free value (a size, a ratio, a file name); number: a whole number */
    control: 'select' | 'text' | 'number',
    choices?: {value: unknown, label: string}[],
    note: string,
    value: unknown,       // what the project has now: its own, else the default
    default: unknown,
    own: boolean,         // written in config.json
}
export type ConfigView = {settings: SettingView[]}
/** What to change: key to value; `null` takes a key back out of config.json, to its default. */
export type ConfigChange = Record<string, unknown>
export type ConfigImpact = {
    /** What is wrong with the change, in the words of the loader: nothing is written then. */
    problems: string[],
    changed: string[],
    /** Clips and pictures that are rendered now and would be made from another plan, so stale */
    stale: {clips: string[], pictures: string[]},
    rendered: {clips: number, pictures: number},
    /** What the loader would warn about */
    notes: string[],
}
export type ConfigResult = ConfigImpact & {written: boolean}
