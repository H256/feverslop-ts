import {parseRetake, type RetakeAsk} from './retake.ts'
import {parseUntil, type UntilStage} from './stages.ts'

// The options of one run that both pipelines take (#841): what is rendered and how - --render, --only, --again, --preview,
// --retake, --refresh, --strict, the own picture of --picture-anchor - and how far it goes: --until, --review, --dry-run [--json].
// Declared and checked here once; each pipeline adds its own (--redo, --beats, --scenes, --export, ...) and its own checks
// of how they go together. The planning stays in each pipeline.

/** For parseArgs: spread into a pipeline's options. */
export const RUN_OPTIONS = {
    render: {type: 'string', default: ''},
    only: {type: 'string', default: ''},
    again: {type: 'boolean', default: false},
    preview: {type: 'boolean', default: false},
    retake: {type: 'string', default: ''},
    'new-anchor': {type: 'boolean', default: false},
    'picture-prompt': {type: 'string', default: ''},
    'picture-anchor': {type: 'string', default: ''},
    'picture-description': {type: 'string', default: ''},
    'describe-picture': {type: 'boolean', default: false},
    refresh: {type: 'string', default: ''},
    strict: {type: 'boolean', default: false},
    // stop after a step that was just generated: accept, edit, again, stop - in a terminal
    review: {type: 'boolean', default: false},
    // plan up to this stage and stop - the story, the cast or the look (lib/stages.ts)
    until: {type: 'string', default: ''},
    // says what --redo, changed inputs and --render would do, and does nothing
    'dry-run': {type: 'boolean', default: false},
    // with --dry-run: what it says as JSON, for the workspace (#836)
    json: {type: 'boolean', default: false},
} as const

export type RunOptionValues = {
    render: string
    only: string
    again: boolean
    preview: boolean
    retake: string
    'new-anchor': boolean
    'picture-prompt': string
    'picture-anchor': string
    'picture-description': string
    'describe-picture': boolean
    refresh: string
    strict: boolean
    review: boolean
    until: string
    'dry-run': boolean
    json: boolean
}

/**
 * What a pipeline can render: a music video also its song (never part of "all"). `clip` is an id and `command` the command line for
 * the examples of the messages.
 */
export type Renderable = {kinds: readonly string[]; clip: string; command: string}
export const MUSIC_RENDER: Renderable = {kinds: ['song', 'images', 'videos', 'final'], clip: 'slot-001', command: 'bun index.ts'}
export const FILM_RENDER: Renderable = {kinds: ['images', 'videos', 'final'], clip: 'clip-005', command: 'bun film.ts'}

/**
 * The words of what is rendered (#937). --render said images and videos, --refresh pictures and clips: each option takes both words
 * now. Inside, a render is images/videos and a refresh pictures/clips, as before.
 */
const RENDER_WORD: Record<string, string> = {pictures: 'images', clips: 'videos'}
const REFRESH_WORD: Record<string, 'pictures' | 'clips'> = {pictures: 'pictures', images: 'pictures', clips: 'clips', videos: 'clips'}

export type RunOptions = {render: Set<string>; refresh: Set<string>; only: string[]; retake?: RetakeAsk; until?: UntilStage}

/**
 * The shared options read and checked, in the order a person would hear about them; throws with the message of the first that is
 * wrong - the pipeline says it as a usage error. `inTerminal`: --review asks there.
 */
export function readRunOptions(args: RunOptionValues, renderable: Renderable, inTerminal: boolean, id = '<id>'): RunOptions {
    // --render=all is images, videos and the final video, in that order - pictures and clips are the same as images and videos
    const render = new Set(
        args.render
            .split(',')
            .filter(Boolean)
            .flatMap(r => (r === 'all' ? ['images', 'videos', 'final'] : [RENDER_WORD[r] ?? r])),
    )
    const unknownRender = [...render].filter(r => !renderable.kinds.includes(r))
    if (unknownRender.length) throw new Error(`--render: unknown "${unknownRender.join(', ')}" - use ${renderable.kinds.join(', ')} or all`)
    // --refresh=images,videos (or pictures,clips) renders what was made from another request than the plan has now (lib/provenance.ts) again
    const refreshWords = args.refresh.split(',').filter(Boolean)
    const unknownRefresh = refreshWords.filter(k => !REFRESH_WORD[k])
    if (unknownRefresh.length) throw new Error(`--refresh: unknown "${unknownRefresh.join(', ')}" - use images, videos (or pictures, clips)`)
    const refresh = new Set(refreshWords.map(k => REFRESH_WORD[k]!))
    // --again renders the ones named in --only once more, with a new seed - the old version is put away in old/attempts/, never overwritten
    if (args.again && !render.has('videos') && !render.has('images'))
        throw new Error('--again goes with --render=videos or --render=images: it renders the clips or pictures named in --only again, with a new seed')
    // --preview: cheap renders into previews/ that never replace a clip (config.json "preview"), or the video of the whole thing made of them
    if (args.preview && !render.has('videos') && !render.has('final')) throw new Error('--preview goes with --render=videos or --render=final')
    if (args.preview && render.has('videos') && render.has('final'))
        throw new Error(
            `--preview: the previews first, then their video - two runs: ${renderable.command} ${id} --render=videos --preview, then ${renderable.command} ${id} --render=final --preview`,
        )
    if (args.retake && render.size) throw new Error('--retake is a run of its own: it renders one part of one clip')
    const retake = args.retake ? parseRetake(args.retake) : undefined
    if ((args['new-anchor'] || args['picture-prompt'] || args['picture-anchor']) && !(args.again && render.has('images')))
        throw new Error('--new-anchor, --picture-prompt and --picture-anchor go with --render=images --only=... --again')
    if ((args['picture-description'] || args['describe-picture']) && !args['picture-anchor'])
        throw new Error('--picture-description and --describe-picture go with --picture-anchor: they describe your own picture')
    if (args['picture-description'] && args['describe-picture'])
        throw new Error('--picture-description or --describe-picture: the description given by hand, or read from the picture')
    const only = args.only.split(',').filter(Boolean)
    if (args['picture-anchor'] && only.length !== 1) throw new Error('--picture-anchor goes with one picture in --only')
    if (args.again && !args.only) throw new Error(`--again needs --only=${renderable.clip},... - say which clips are rendered again, every one is GPU time`)
    if (args.review && !inTerminal) throw new Error('--review asks in the terminal - run it in one')
    if (args.json && !args['dry-run']) throw new Error('--json goes with --dry-run: what the run would do, as data')
    if (args.review && args['dry-run']) throw new Error('--review and --dry-run do not go together: a dry run generates nothing to look at')
    const until = parseUntil(args.until)
    return {render, refresh, only, ...(retake ? {retake} : {}), ...(until ? {until} : {})}
}
