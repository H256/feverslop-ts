import type {CommandSchema, OptionSpec} from './command-schema.ts'

// The options of the two pipelines, `bun index.ts` (plan) and `bun film.ts` (film), written down once (#1154): their parsers, the usage
// line of a usage error, the table of lib/cli.ts and the options of --help (lib/cli-help.ts) come from here. They were four lists that
// had drifted apart. No imports of the pipeline: --help stays instant.

const text = (shown: string, help: string, more: {default?: string} = {}) => ({kind: 'text', shown, help, default: '', ...more}) as const
/** a text a run may leave unsaid: undefined, not '' - the settings decide then */
const unsaid = (shown: string, help: string) => ({kind: 'text', shown, help}) as const
const flag = (help: string) => ({kind: 'flag', help}) as const

/**
 * The options of a run both pipelines take (#841): what is rendered and how, how far it goes. Checked by lib/run-options.ts;
 * `render` and `json` say what each pipeline renders and prints.
 */
const runOptions = (clip: string, render: {shown: string; help: string}, json: string) =>
    ({
        render: text(render.shown, render.help),
        only: text(`${clip},…`, 'Only these clips or pictures (with --render=videos, final or images); try one before all - every clip is GPU time'),
        again: flag('Render the clips or pictures in --only once more with a new seed; the old version is kept. Needs --render=videos or images'),
        'new-anchor': flag('With --render=images --again: a reference sheet gets a new anchor too - another person or place, not only other views'),
        'picture-prompt': text('FILE', 'With --render=images --only=ID --again: render this one picture from the words in FILE and keep it (pinned)'),
        'picture-anchor': text(
            'FILE',
            'With --render=images --only=ID --again: put your own picture in as the anchor of this one picture and draw its sheet from it; the old one is kept',
        ),
        'picture-description': text('FILE', 'With --picture-anchor: what the clips and the sheet say of it, from FILE, into project.json'),
        'describe-picture': flag('With --picture-anchor: the description read from your picture by the vision model (bun run setup vision)'),
        preview: flag(
            'With --render=videos: cheap renders into previews/ (config.json "preview"), never a clip. With --render=final: a low-resolution video from them',
        ),
        retake: text(
            `${clip}:3.2-5.0`,
            `Render part of a clip again, between the frames around it: ${clip}:3.2-5.0 in seconds, or ${clip}:shot2. The old clip is kept`,
        ),
        refresh: text(
            'images,videos',
            'Render again what is stale - made from an older plan; the old files go to old/attempts/. pictures, clips say the same. With --preview: the previews of an older plan',
        ),
        strict: flag('Refuse stale clips in the final video instead of only listing them'),
        review: flag('Stop after each main step that was just generated: accept, edit, generate again or stop'),
        until: text(
            'story|cast|look',
            'Plan up to story, cast or look and stop there; the next run goes on from it. --until=look --render=images renders the pictures of the cast and the places first',
        ),
        'dry-run': flag('Say what this command would redo and render, with an estimate where one is known; does nothing'),
        json: flag(json),
    }) satisfies Record<string, OptionSpec>

const servers = {
    'llm-url': unsaid('URL', 'LLM server for this run, instead of the settings'),
    'llm-key': unsaid('KEY', 'API key of that server'),
    'llm-model': unsaid('MODEL', 'Model for this run'),
    comfy: unsaid('URL,URL', 'ComfyUI servers for this run'),
} satisfies Record<string, OptionSpec>

const redo = 'Generate these steps again, and every step built on them'

export const planCommand = {
    command: 'plan',
    script: 'index.ts',
    positionals: '[project-id]',
    options: {
        redo: text('story,beats', redo),
        beats: text('beat-05,beat-07', 'With --redo=shotMoments: plan only the shots of these beats again; the other beats and their clips stay'),
        ...runOptions(
            'slot-001',
            {
                shown: 'song,images,videos,final|all',
                help: 'Also render: the song, the pictures, the clips, the final video. all = images, videos and final - never the song: --render=song makes a new one and is asked for by name',
            },
            'With --dry-run: what it would do as JSON - the reasons, the steps made again, the beats planned again, the renders',
        ),
        show: text('story,cast,clips', 'Print the details of these cached steps; clips = the clip prompts'),
        export: text('mlt,openshot|all', 'Write a timeline for Shotcut/Kdenlive and/or OpenShot'),
        gallery: flag('Write gallery.html, an overview of the assets so far; runs nothing else'),
        ...servers,
        'llm-parallel': unsaid('N', 'LLM calls at the same time'),
        'legacy-moments': flag('Skip blocking and shotMoments, spread beat.moments across the shots the old way'),
        'debug-audio': flag('Also cut one listenable wav per track and clip into output/audio'),
    },
} as const satisfies CommandSchema

export const filmCommand = {
    command: 'film',
    script: 'film.ts',
    positionals: '<film-id>',
    options: {
        redo: text('screenplay,cast', redo),
        ...runOptions(
            'clip-001',
            {shown: 'images,videos,final|all', help: 'Also render: the pictures, the clips, the film. all = all three'},
            'With --dry-run: what it would do as JSON - the reasons, the steps made again, the scenes planned again, the renders',
        ),
        scenes: text('s6,s7', 'With --redo=coverage: plan only these scenes again; the other shots and their clips stay'),
        'fix-script': flag('Repair a handed-in screenplay; by default its contradictions are only reported'),
        'allow-import-gaps': flag('Go on when importing a screenplay lost a line, instead of stopping'),
        ...servers,
    },
} as const satisfies CommandSchema
