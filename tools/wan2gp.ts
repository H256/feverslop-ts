import {cli} from '../lib/cli.ts'
// wan2gp as a render engine (#1191, #1192): put the bridge plugin into a wan2gp folder, look at a server, or render one job of
// wan2gp settings through it - its local input files uploaded, its outputs downloaded. Planning stays here; wan2gp only renders.
// usage: bun run wan2gp install <wangp-folder>
//        bun run wan2gp health <wangp-url>
//        bun run wan2gp render <wangp-url> --settings=<file.json> [--out=<folder>]
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {bridgeClient, type BridgeSettings, waitForJob, withUploads} from '../lib/wan2gp.ts'
cli('wan2gp')

const usage = 'usage: bun run wan2gp install <wangp-folder> | health <wangp-url> | render <wangp-url> --settings=<file.json> [--out=<folder>]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {settings: {type: 'string'}, out: {type: 'string'}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const [action, where, ...extra] = positionals
if (extra.length) log.usageError(`one ${action === 'install' ? 'folder' : 'address'}, not "${extra.join(' ')}"`, usage)
if (!where) log.usageError(action === 'install' ? 'which wan2gp folder?' : 'which wan2gp address? e.g. http://127.0.0.1:7860', usage)

// the folder name starts with wangp-: wan2gp's .gitignore ignores it, so a git pull of wan2gp is not disturbed
const PLUGIN_FOLDER = 'wangp-feverslop'
const SOURCE = join(import.meta.dir, '..', 'wan2gp', 'plugin')

if (action === 'install') {
    const root = resolve(where!)
    if (!existsSync(join(root, 'wgp.py')) || !existsSync(join(root, 'plugins'))) log.usageError(`${root} is no wan2gp folder (no wgp.py and plugins/)`, usage)
    const target = join(root, 'plugins', PLUGIN_FOLDER)
    // the plugin's own files only: an update replaces them, its tests and caches stay out
    rmSync(target, {recursive: true, force: true})
    mkdirSync(target, {recursive: true})
    for (const file of ['__init__.py', 'bridge.py', 'plugin.py', 'plugin_info.json', 'README.md']) cpSync(join(SOURCE, file), join(target, file))
    log.step('Plugin', target)
    log.next(`restart wan2gp   ${styles.muted('- then: bun run wan2gp health <its address>')}`)
    log.success('The bridge is in wan2gp')
} else if (action === 'health') {
    const client = bridgeClient(where!)
    const said = await client
        .health()
        .catch((e: unknown) =>
            log.fatal(
                `${client.base} does not answer as the bridge: ${e instanceof Error ? e.message : String(e)} - is the plugin installed and wan2gp restarted?`,
            ),
        )
    log.step('Bridge', `${client.base} ${styles.muted(`api ${said.bridge}, wan2gp ${said.wangp}`)}`)
    log.success('The bridge answers')
} else if (action === 'render') {
    if (!args.settings) log.usageError('--settings=<file.json>: the wan2gp settings of the job', usage)
    const settings = JSON.parse(readFileSync(args.settings!, 'utf8')) as BridgeSettings
    if (!('model_type' in settings) && !('template' in settings)) log.usageError('the settings need a model_type or a template', usage)
    const client = bridgeClient(where!)
    const sent = await withUploads(client, settings, value => existsSync(value))
    const job = await client.generate(sent)
    log.step('Job', `${job.id} ${styles.muted(job.status)}`)
    const done = await waitForJob(client, job.id, now => {
        const p = now.progress
        log.step(
            now.status,
            [p.phase, p.step && p.steps ? `step ${p.step}/${p.steps}` : '', p.windows ? `window ${p.window}/${p.windows}` : ''].filter(Boolean).join(' · '),
        )
    })
    const out = resolve(args.out ?? '.')
    mkdirSync(out, {recursive: true})
    for (const file of done.files) {
        const target = join(out, file.name)
        writeFileSync(target, Buffer.from(await client.download(done.id, file.index)))
        log.step('Saved', target)
    }
    log.success(`Rendered on ${client.base}`)
} else log.usageError(`"${action ?? ''}" is none of install, health, render`, usage)
