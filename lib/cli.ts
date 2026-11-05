import {helpDetails} from "./cli-help.ts";
import {configureOutput, failRun, formatDuration, log, printBanner, runLogFile, runResult, runWarnings, setOutput, styles} from './log.ts';

// Shared options are consumed before each tool's own parser. Never inspect values after `--`.
// banner: the logo at the start - true for the plain one, a string for one with the tool's name under it
const commands: Record<string, {args: string, description: string, json?: boolean, banner?: boolean | string}> = {
    plan: {args: '[project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001] [--again] [--preview] [--retake=slot-007:3.2-5.0] [--new-anchor] [--picture-prompt=FILE] [--refresh=pictures,clips] [--strict] [--review] [--until=story|cast|look] [--dry-run] [--show=story,cast,clips] [--export=mlt,openshot|all] [--gallery] [--llm-url=URL] [--llm-key=KEY] [--llm-model=MODEL] [--llm-parallel=N] [--comfy=URL] [--legacy-moments] [--debug-audio]', description: 'Plan and render a music video; existing steps are reused.'},
    film: {args: '<film-id> [--redo=steps] [--render=images,videos,final|all] [--only=clip-001] [--again] [--preview] [--retake=clip-007:3.2-5.0] [--new-anchor] [--picture-prompt=FILE] [--fix-script] [--allow-import-gaps] [--refresh=pictures,clips] [--strict] [--scenes=s6,s7] [--review] [--until=story|cast|look] [--dry-run] [--llm-url=URL] [--llm-key=KEY] [--llm-model=MODEL] [--comfy=URL]', description: 'Plan and render a film.'},
    setup: {args: '[llm|llm-model|vision|comfy|show]', description: 'Configure servers, or show the effective settings.', banner: true},
    init: {args: '[project-id]', description: 'Create a music-video project interactively.', banner: true},
    'film:init': {args: '[film-id]', description: 'Create a film project interactively.', banner: true},
    example: {args: '[--no-render]', description: 'Create an example project and optionally generate its song.'},
    'replace-character': {args: '<project-id>', description: 'Replace a character interactively.'},
    'film:replace-character': {args: '[film-id]', description: 'Replace a film character interactively.'},
    story: {args: '<project-id> [--film] [--out=story.txt | --set=story.txt | --adapt [--add="Name: role"] [--remove=<id>] | --take | --drop | --rename="Old Name=New Name"]', description: 'Print the story (a film: its screenplay), replace it, or have it told anew for the cast as a proposal (alias: adapt-story) - a film for a role added or taken out. What was planned from it goes.'},
    cast: {args: '<project-id> [--film] [--json | --set=cast.json]', description: 'Print the cast, or change names, roles and props and who is in it. What was planned from it goes; a music video keeps the looks of whoever stays.', json: true},
    look: {args: '<project-id> [--film] [--json | --set=look.json | --again=<id>,location:<id>]', description: 'Print the look of the whole and of every character and place, change texts, or have single ones written anew.', json: true},
    config: {args: '<project-id> [--film] [--json] [--set=<setting>=<value>]... [--unset=<setting>]...', description: 'Print the render settings of a project (config.json), or change them: workflows, sizes, retries, final frame rate. Says which rendered clips and pictures a change makes stale.', json: true},
    singers: {args: '<project-id> [--json | --set=singers.json | --line=<n>:<singer>,<singer>]', description: 'Print who sings which line, or change it. The beats a changed line is sung in are planned again.', json: true},
    timing: {args: '<project-id> [--json | --set=timing.json]', description: 'Print when each sung line is, or move its words. The beats of the clips a moved line is in are planned again.', json: true},
    versions: {args: '<project-id> <clip-id|picture-id> [--film] [--pick=<version>]', description: 'List the older versions of a clip or picture, or make one the current version again.'},
    override: {args: '<film-id> <clip-id> [--view=<n>] [--order=<picture>,...] [--without=<picture>,...] [--clear]', description: 'The own view of its place and choice of references of a film clip, from the next plan run on.'},
    casting: {args: '<project-id> [--film] [--set=character:<id>=library:<asset>]...', description: 'Print casting.json and what the next plan run takes over, with the --redo it needs; change entries.'},
    'import-asset': {args: '<project-id> [asset-id] [--from=project[:id]|library:id]', description: 'Import a character or location into a project.'},
    'export-asset': {args: '<project-id> <asset-id> [--as=library-id] [--film]', description: 'Export a character or location to the shared library.'},
    'export-song': {args: '<project-id> [--as=song-id] [--name=name]', description: 'Put the song of a project into the library: audio, lyrics, stems and the timing of every word.'},
    'import-song': {args: '<project-id> [song-id]', description: 'Take a song of the library into a project, or list the songs; the plan starts at the story.'},
    'create-asset': {args: '<character|location> <library-id> --anchor=picture [--name=name] [--role=role] [--description=text] [--like=project]', description: 'Create a library asset from a reference picture.'},
    'film:check-joins': {args: '<film-id> [--only=clip-004] [--again]', description: 'Check the cuts within a scene with a vision model: posture, clothes and props across the cut. Only reports.'},
    'film:gallery': {args: '', description: 'Write films/index.html with the available films.'},
    'film:migrate': {args: '<film-id> <old-film-folder> [--apply]', description: 'Preview or apply migration of compatible rendered clips.'},
    'leak-scan': {args: '<project-id> [--film]', description: 'Check rendered clips for leaked studio backdrops.'},
    'texture-chains': {args: '<project-id> [--film] [--json]', description: 'Measure whether continuing clips get grittier from link to link. Only reads.', json: true},
    interpolate: {args: '<project-id> --only=slot-001,... --model=file,... [--multiplier=5] [--comfy=URL]', description: 'Interpolate the rendered clips of a project.'},
    status: {args: '<project-id> [--json] [--film]', description: 'Show project state and the next command.', json: true},
    inspect: {args: '<project-id> <clip-id> [--json] [--film]', description: 'Inspect one clip, its references and prompt.', json: true},
    stats: {args: '[--by=variant,gpu] [--kind=clip|picture|song|interpolation|llm] [--project=id] [--since=7d] [--sort=name|median|p90|n|failed] [--top=N] [--compare] [--baseline="GPU or group"] [--details] [--json]', description: 'Compare measured render and LLM performance.', json: true},
    refinish: {args: '<id> [--film] [--preset=grade|smooth|fullhd] [--upscale=none|refine|latent|model] [--size=fullhd|2x|WxH] [--model=<file>] [--denoise=0.2] [--fps=48] [--finish] [--only=slot-001] [--again] [--comfy=URL]', description: 'Make a finished project larger, 48 fps and finished, without rendering it again. Nothing it has is overwritten.'},
    label: {args: '<id> [--film] [--from=<video>] [--marker=generated-white|<png>] [--mode=credits|interval|always] [--seconds=5] [--interval=60] [--corner=top-right|top-left|bottom-right|bottom-left] [--size=6] [--margin=3] [--save | --save-default] [--dry-run]', description: 'Put the AI marker (an EU icon or a PNG of your own) over a finished video: <name>-labeled.mp4 next to it. Optional, see docs/postwork.md.'},
    'add-view': {args: '<film-id> <location-id> --name=<where the camera is> --shows=<what is seen> [--from=<view>] [--comfy=URL]', description: 'Render one more view of a place of a film, from its anchor or another view; one that looks back the other way in two moves.'},
    editor: {args: '[project-id] [--film] [--port=4173]', description: 'Open the workspace in the browser: all projects, the whole video on one timeline, renders, library and casting.', banner: 'Editor'},
    'client:build': {args: '', description: 'Build the Vue workspace client and install its static files. Stop the preview editor before updating its build.'},
    typecheck: {args: '', description: 'Check project TypeScript types.'},
    'styles:doc': {args: '', description: 'Regenerate the style reference document.'},
    'comfy:types': {args: '[--comfy=URL]', description: 'Regenerate typed ComfyUI nodes from the configured server.'},
    'comfy:convert': {args: '<workflow-api.json> <name> --kind=image|video|audio|sequence [--force] [--comfy=URL]', description: 'Convert a ComfyUI API workflow into TypeScript.'},
}

export function cli(command: string) {
    const spec = commands[command]!
    const invocation = command === 'plan' ? 'bun index.ts' : `bun run ${command}`
    const usage = `${invocation} ${spec.args}`.trim()
    const original = Bun.argv.slice(2)
    const end = original.indexOf('--')
    const options = end < 0 ? original : original.slice(0, end)
    if (options.includes('--help') || options.includes('-h')) {
        log.info(`${styles.name(command)} — ${spec.description}\n\nUsage: ${usage}${helpDetails(command)}\n\nCommon options:\n  -h, --help     Show help without starting work\n  -v, --verbose  Show cached and detailed output\n      --debug    Show stack traces for failures\n      --quiet    Hide human output; keep warnings, errors and prompts\n      --banner   Show the large terminal banner\n\nSee docs/cli.md for output modes and recovery.`)
        process.exit(0)
    }
    const common = new Set(['--verbose', '-v', '--debug', '--quiet', '--banner'])
    const machine = !!spec.json && options.includes('--json')
    // Existing status parsing owns --json; inspect has a positional parser.
    if (command === 'inspect') common.add('--json')
    const filtered = options.filter(arg => !common.has(arg))
    Bun.argv.splice(2, original.length, ...filtered, ...(end < 0 ? [] : original.slice(end)))
    const hint = `Help: ${invocation} --help${command === 'plan' || command === 'film' ? '\nCompleted outputs are retained. Correct the reported problem and rerun the same command to reuse completed work.' : ''}`
    // Child pipeline runs launched by init/example inherit the chosen output mode.
    if (options.includes('--quiet')) process.env.FEVERSLOP_QUIET = '1'
    if (options.includes('--verbose') || options.includes('-v')) process.env.FEVERSLOP_VERBOSE = '1'
    if (options.includes('--debug')) process.env.FEVERSLOP_DEBUG = '1'
    configureOutput({quiet: process.env.FEVERSLOP_QUIET === '1', json: machine, debug: process.env.FEVERSLOP_DEBUG === '1', hint})
    setOutput({verbose: process.env.FEVERSLOP_VERBOSE === '1'})
    process.on('unhandledRejection', failRun)
    process.on('uncaughtException', failRun)
    if (spec.banner || options.includes('--banner')) printBanner(typeof spec.banner === 'string' ? spec.banner : undefined)
    const context = filtered[0] && !filtered[0].startsWith('-') ? filtered[0] : ''
    const mode = filtered.find(a => /^--(render|dry-run|gallery|apply)(=|$)/.test(a))
    log.info(`${styles.name(command.toUpperCase())}${context ? ` · ${context}` : ''}${mode ? ` · ${mode.slice(2)}` : ''}`)
    const start = Date.now()
    process.on('exit', code => {
        if (code !== 0 || runResult().cancelled) return
        log.success(`${command} · ${formatDuration(Date.now() - start)} · ${runWarnings().length} warning(s)`)
        if (runResult().output) log.info(`Output: ${runResult().output}`)
        if (runResult().next && !runResult().nextShown) log.info(`Next: ${runResult().next}`)
        if (runLogFile()) log.info(`Log: ${runLogFile()}`)
    })
}
