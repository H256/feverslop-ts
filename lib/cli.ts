import {configureOutput, failRun, formatDuration, log, printBanner, runLogFile, runResult, runWarnings, setOutput, styles} from './log.ts';

// Shared options are consumed before each tool's own parser. Never inspect values after `--`.
const commands: Record<string, {args: string, description: string, json?: boolean, banner?: boolean}> = {
    plan: {args: '[project-id] [--redo=story,beats] [--render=song,images,videos,final|all] [--only=slot-001] [--again] [--refresh=pictures,clips] [--strict] [--review] [--dry-run] [--show=story,cast,clips] [--export=mlt,openshot|all] [--gallery] [--llm-url=URL] [--llm-key=KEY] [--llm-model=MODEL] [--llm-parallel=N] [--comfy=URL] [--legacy-moments] [--debug-audio]', description: 'Plan and render a music video; existing steps are reused.'},
    film: {args: '<film-id> [--redo=steps] [--render=images,videos,final|all] [--only=clip-001] [--again] [--fix-script] [--allow-import-gaps] [--refresh=pictures,clips] [--strict] [--scenes=s6,s7] [--llm-url=URL] [--llm-key=KEY] [--llm-model=MODEL] [--comfy=URL]', description: 'Plan and render a film.'},
    setup: {args: '[llm|llm-model|comfy|show]', description: 'Configure servers, or show the effective settings.', banner: true},
    init: {args: '[project-id]', description: 'Create a music-video project interactively.', banner: true},
    'film:init': {args: '[film-id]', description: 'Create a film project interactively.', banner: true},
    example: {args: '[--no-render]', description: 'Create an example project and optionally generate its song.'},
    'replace-character': {args: '<project-id>', description: 'Replace a character interactively.'},
    'film:replace-character': {args: '[film-id]', description: 'Replace a film character interactively.'},
    'import-asset': {args: '<project-id> [asset-id] [--from=project[:id]|library:id]', description: 'Import a character or location into a project.'},
    'export-asset': {args: '<project-id> <asset-id> [--as=library-id]', description: 'Export a character or location to the shared library.'},
    'create-asset': {args: '<character|location> <library-id> --anchor=picture [--name=name] [--role=role] [--description=text] [--like=project]', description: 'Create a library asset from a reference picture.'},
    'film:gallery': {args: '', description: 'Write films/index.html with the available films.'},
    'film:migrate': {args: '<film-id> <old-film-folder> [--apply]', description: 'Preview or apply migration of compatible rendered clips.'},
    'leak-scan': {args: '<project-id>', description: 'Check rendered clips for leaked studio backdrops.'},
    interpolate: {args: '<project-id> --only=slot-001,... --model=file,... [--multiplier=5] [--comfy=URL]', description: 'Interpolate the rendered clips of a project.'},
    status: {args: '<project-id> [--json]', description: 'Show project state and the next command.', json: true},
    inspect: {args: '<project-id> <clip-id> [--json]', description: 'Inspect one clip, its references and prompt.', json: true},
    stats: {args: '[--by=variant,gpu] [--kind=clip|picture|song|interpolation|llm] [--project=id] [--since=7d] [--sort=name|median|p90|n|failed] [--top=N] [--compare] [--baseline="GPU or group"] [--details] [--json]', description: 'Compare measured render and LLM performance.', json: true},
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
        log.info(`${styles.name(command)} — ${spec.description}\n\nUsage: ${usage}\n\nCommon options:\n  -h, --help     Show help without starting work\n  -v, --verbose  Show cached and detailed output\n      --debug    Show stack traces for failures\n      --quiet    Hide human output; keep warnings, errors and prompts\n      --banner   Show the large terminal banner\n\nSee docs/cli.md for output modes and recovery.`)
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
    if (spec.banner || options.includes('--banner')) printBanner()
    const context = filtered[0] && !filtered[0].startsWith('-') ? filtered[0] : ''
    const mode = filtered.find(a => /^--(render|dry-run|gallery|apply)(=|$)/.test(a))
    log.info(`${styles.name(command.toUpperCase())}${context ? ` · ${context}` : ''}${mode ? ` · ${mode.slice(2)}` : ''}`)
    const start = Date.now()
    process.on('exit', code => {
        if (code !== 0 || runResult().cancelled) return
        log.success(`${command} · ${formatDuration(Date.now() - start)} · ${runWarnings().length} warning(s)`)
        if (runResult().output) log.info(`Output: ${runResult().output}`)
        if (runResult().next) log.info(`Next: ${runResult().next}`)
        if (runLogFile()) log.info(`Log: ${runLogFile()}`)
    })
}
