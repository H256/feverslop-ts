import {cli} from '../lib/cli.ts'
// wan2gp as a render engine (#1191, #1192): put the bridge plugin into a wan2gp folder, look at a server, or render one job of
// wan2gp settings through it - its local input files uploaded, its outputs downloaded. Planning stays here; wan2gp only renders.
// usage: bun run wan2gp install <wangp-folder> [--repo=<git-url>]
//        bun run wan2gp health <wangp-url>
//        bun run wan2gp render <wangp-url> --settings=<file.json> [--out=<folder>]
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {log, styles} from '../lib/log.ts'
import {bridgeClient, type BridgeSettings, waitForJob, withUploads} from '../lib/wan2gp.ts'
cli('wan2gp')

const usage =
    'usage: bun run wan2gp install <wangp-folder> [--repo=<git-url>] | health <wangp-url> | render <wangp-url> --settings=<file.json> [--out=<folder>]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {settings: {type: 'string'}, out: {type: 'string'}, repo: {type: 'string'}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const [action, where, ...extra] = positionals
if (extra.length) log.usageError(`one ${action === 'install' ? 'folder' : 'address'}, not "${extra.join(' ')}"`, usage)
if (!where) log.usageError(action === 'install' ? 'which wan2gp folder?' : 'which wan2gp address? e.g. http://127.0.0.1:7860', usage)

// the plugin is its own repository, kept as a git checkout in the wan2gp folder; its folder name starts with wangp-: wan2gp's
// .gitignore ignores it, so a git pull of wan2gp is not disturbed
const PLUGIN_FOLDER = 'wangp-feverslop'
// no git host is written in here: the plugin's repository is taken to sit beside this checkout's own, on the same server
// (<origin of feverslop-ts> with wangp-feverslop for feverslop-ts) - --repo names another
function pluginRepo(): string | undefined {
    const origin = Bun.spawnSync(['git', '-C', import.meta.dir, 'remote', 'get-url', 'origin'], {stdout: 'pipe', stderr: 'pipe'})
    const url = new TextDecoder().decode(origin.stdout).trim()
    return /feverslop-ts(.git)?$/.test(url) ? url.replace(/feverslop-ts(.git)?$/, 'wangp-feverslop.git') : undefined
}

function git(gitArgs: string[]) {
    const done = Bun.spawnSync(['git', ...gitArgs], {stdout: 'pipe', stderr: 'pipe'})
    if (done.exitCode !== 0) log.fatal(`git ${gitArgs.join(' ')} failed:\n${new TextDecoder().decode(done.stderr).trim()}`)
    return new TextDecoder().decode(done.stdout).trim()
}

if (action === 'install') {
    const root = resolve(where!)
    if (!existsSync(join(root, 'wgp.py')) || !existsSync(join(root, 'plugins'))) log.usageError(`${root} is no wan2gp folder (no wgp.py and plugins/)`, usage)
    const target = join(root, 'plugins', PLUGIN_FOLDER)
    if (existsSync(join(target, '.git'))) {
        // there already: brought up to date, never overwritten - changes made in it stop the pull
        git(['-C', target, 'pull', '--ff-only'])
        log.step('Updated', `${target} ${styles.muted(git(['-C', target, 'log', '-1', '--format=%h %s']))}`)
    } else if (existsSync(target)) {
        log.fatal(`${target} is there but is no git checkout - move it away, then install again`)
    } else {
        const repo = args.repo ?? pluginRepo()
        if (!repo) log.usageError('which repository? This checkout has no origin to find the plugin beside - give --repo=<git url of wangp-feverslop>', usage)
        git(['clone', repo!, target])
        log.step('Cloned', target)
    }
    // wan2gp loads a plugin of its plugins/ folder only when wgp_config.json lists it under enabled_plugins: a clone alone stays off
    const configFile = join(root, 'wgp_config.json')
    if (!existsSync(configFile)) {
        log.warn(`no ${configFile} yet (wan2gp has not run here): enable "FeverSlop Bridge" in its Apps & PlugIn Manager after the first start`)
    } else {
        const config = JSON.parse(readFileSync(configFile, 'utf8')) as {enabled_plugins?: unknown}
        const enabled = Array.isArray(config.enabled_plugins) ? (config.enabled_plugins as string[]) : []
        if (enabled.includes(PLUGIN_FOLDER)) log.step('Enabled', styles.muted('already in enabled_plugins'))
        else {
            config.enabled_plugins = [...enabled, PLUGIN_FOLDER]
            // written the way wan2gp writes it: four spaces
            writeFileSync(configFile, JSON.stringify(config, null, 4))
            log.step(
                'Enabled',
                `${PLUGIN_FOLDER} ${styles.muted(`in ${configFile} - a wan2gp that is running can write its old list over it: stop it first, or enable the plugin in its Apps & PlugIn Manager`)}`,
            )
        }
    }
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
