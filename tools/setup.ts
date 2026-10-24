import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Sets up the LLM server and the ComfyUI servers - writes the global settings file (see the README, section "Setup").
// usage: bun run setup [llm | llm-model | vision | comfy | show]
import * as p from "@clack/prompts";
import {existsSync} from "node:fs";
import {listModels, takesPictures} from "../lib/llm.ts";
import {styles} from "../lib/log.ts";
import {
    type ComfyEntry, type ComfyServer, defaultComfy, describeDevices, loadSettings, maskSecret, normalizeUrl,
    parseComfyEntries, probeComfy, readSettingsFile, saveSettings, type SettingsFile, settingsPath, type Source,
} from "../lib/settings.ts";
cli('setup')


const commands = {
    all: 'everything below, in order',
    llm: 'the LLM server: URL, API key and model',
    'llm-model': 'only the model of the configured LLM server',
    vision: 'the model that describes pictures: another model or server, or the text model',
    comfy: 'the ComfyUI servers: add, remove, test',
    show: 'the effective settings and where each comes from',
}
const command = (Bun.argv[2] ?? 'all') as keyof typeof commands
if (!(command in commands)) {
    log.error(`usage: bun run setup [${Object.keys(commands).filter(c => c !== 'all').join(' | ')}]\n`)
    for (const [name, what] of Object.entries(commands)) log.error(`  ${(name === 'all' ? '(none)' : name).padEnd(10)} ${what}`)
    process.exit(1)
}

if (command === 'show') {
    await show()
    process.exit(0)
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printWithoutTerminal()
    process.exit(1)
}

const file = await readSettingsFile()
log.section(`feverslop-ts setup ${styles.muted(settingsPath())}`)
if (command === 'all' || command === 'llm') await setupLlm()
if (command === 'llm-model') await setupModel()
if (command === 'all' || command === 'vision') await setupVision()
if (command === 'all' || command === 'comfy') await setupComfy()
log.success('Done - see the result with: bun run setup show')

// cancelled with Ctrl+C / Esc: stop without saving the current part
function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        log.cancel('Cancelled - nothing more saved')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}

async function save(what: string) {
    await saveSettings(file)
    log.success(`Saved ${what} to ${settingsPath()}`)
}

function validateUrl(value?: string) {
    try {
        normalizeUrl(value ?? '', 'URL')
    } catch (e) {
        return (e as Error).message.replace(/^URL: /, '')
    }
}

/** Lists the models - null when the server doesn't answer. */
async function fetchModels(url: string, apiKey?: string) {
    const spinner = p.spinner()
    spinner.start(`Connecting to ${url}`)
    try {
        const ids = await listModels(url, apiKey, 15_000)
        spinner.stop(`${url}: ${ids.length} model(s)`)
        return ids
    } catch (e) {
        spinner.error(`${url}: ${(e as Error).message}`)
        return null
    }
}

async function selectModel(ids: string[], current?: string) {
    if (!ids.length) {
        log.warn('The server lists no models - load one, then run: bun run setup llm-model')
        return undefined
    }
    return answer(await p.select({
        message: 'Model',
        options: ids.map(id => ({value: id, ...(id === current ? {hint: 'current'} : {})})),
        initialValue: ids.includes(current ?? '') ? current : ids[0],
        maxItems: 12,
    }))
}

async function setupLlm() {
    log.info('LLM server - any OpenAI-compatible server with the Responses API')
    const url = normalizeUrl(answer(await p.text({
        message: 'URL (with /v1)',
        placeholder: 'http://localhost:8080/v1',
        initialValue: file.llm?.url ?? '',
        validate: validateUrl,
    })), 'URL')
    const current = file.llm?.apiKey
    const typed = answer(await p.password({
        message: current ? `API key - empty keeps ${maskSecret(current)}, "-" removes it` : 'API key - empty if the server needs none',
    })) ?? ''
    const apiKey = typed === '-' ? undefined : typed || current

    const ids = await fetchModels(url, apiKey)
    let model = file.llm?.model
    if (ids) {
        model = await selectModel(ids, model)
    } else if (!answer(await p.confirm({message: 'The server does not answer - save anyway?', initialValue: false}))) {
        return log.info('LLM settings unchanged')
    }
    file.llm = {url, ...(apiKey ? {apiKey} : {}), ...(model ? {model} : {}), ...(file.llm?.parallel ? {parallel: file.llm.parallel} : {}), ...(file.llm?.vision ? {vision: file.llm.vision} : {})}
    await save('the LLM server')
}

async function setupModel() {
    // the effective server - it may come from an env var
    const {llm, sources} = await loadSettings()
    if (!llm.url) {
        log.error('No LLM server configured - run: bun run setup llm')
        process.exit(1)
    }
    if (sources.llmModel === 'env') log.warn('FEVERSLOP_LLM_MODEL is set - it overrides the model saved here')
    const ids = await fetchModels(llm.url, llm.apiKey)
    if (!ids) process.exit(1)
    const model = await selectModel(ids, llm.model)
    if (!model) return
    file.llm = {...file.llm, model}
    await save(`the model ${model}`)
}

async function setupVision() {
    log.info('Vision model - describes pictures (replace-character, import-asset, create-asset); for a text server without a vision projector')
    if (process.env.FEVERSLOP_VISION_URL || process.env.FEVERSLOP_VISION_MODEL) log.warn('FEVERSLOP_VISION_URL / FEVERSLOP_VISION_MODEL is set - it overrides what is saved here')
    // the effective text server - it may come from an env var
    const {llm} = await loadSettings()
    const current = file.llm?.vision
    const where = answer(await p.select({
        message: 'Pictures are described by',
        options: [
            {value: 'text', label: 'The text model', hint: llm.model ?? 'the server\'s only model'},
            ...(llm.url ? [{value: 'same', label: 'Another model on the text server', hint: llm.url}] : []),
            {value: 'other', label: 'A model on another server'},
        ],
        initialValue: current?.url ? 'other' : current?.model && llm.url ? 'same' : 'text',
    }))
    if (where === 'text') {
        if (file.llm?.vision) {
            delete file.llm.vision
            await save('no vision model - the text model describes pictures')
        }
        const ids = llm.model ? [llm.model] : llm.url ? await fetchModels(llm.url, llm.apiKey) : null
        if (llm.url && ids?.length === 1) await reportVision(llm.url, ids[0]!, llm.apiKey)
        return
    }
    let url = llm.url!
    let apiKey = llm.apiKey
    if (where === 'other') {
        url = normalizeUrl(answer(await p.text({
            message: 'URL (with /v1)',
            placeholder: 'http://localhost:8081/v1',
            initialValue: current?.url ?? '',
            validate: validateUrl,
        })), 'URL')
        const typed = answer(await p.password({
            message: current?.apiKey ? `API key - empty keeps ${maskSecret(current.apiKey)}, "-" removes it` : 'API key - empty if the server needs none',
        })) ?? ''
        apiKey = typed === '-' ? undefined : typed || current?.apiKey
    }
    const ids = await fetchModels(url, apiKey)
    let model = current?.model
    if (ids) {
        model = await selectModel(ids, model)
        if (model) await reportVision(url, model, apiKey)
    } else if (!answer(await p.confirm({message: 'The server does not answer - save anyway?', initialValue: false}))) {
        return log.info('Vision settings unchanged')
    }
    if (where === 'same' && !model) return log.info('Vision settings unchanged')
    file.llm = {...file.llm, vision: where === 'other' ? {url, ...(apiKey ? {apiKey} : {}), ...(model ? {model} : {})} : {model}}
    await save(`the vision model${model ? ` ${model}` : ''}`)
}

/** Says whether the model takes pictures, as far as the server tells (lib/llm.ts takesPictures). */
async function reportVision(url: string, model: string, apiKey?: string) {
    const takes = await takesPictures(url, model, apiKey)
    if (takes === true) log.success(`${model} takes pictures`)
    else if (takes === false) log.warn(`${model} takes no pictures, the server says - describing a picture will fail (llama-server: load it with --mmproj)`)
    else log.info(styles.muted(`${url} does not tell whether ${model} takes pictures - the first picture will show`))
}

async function setupComfy() {
    log.info('ComfyUI servers - pictures and clips are rendered on all of them in parallel')
    if (process.env.FEVERSLOP_COMFY || process.env.COMFY) log.warn('FEVERSLOP_COMFY / COMFY is set - it overrides the servers saved here')
    while (true) {
        const entries = file.comfy ?? []
        const servers = entries.length ? parseComfyEntries(entries, 'comfy') : []
        await showComfyStatus(servers)

        const action = answer(await p.select({
            message: 'ComfyUI servers',
            options: [
                {value: 'add', label: 'Add a server'},
                ...(servers.length ? [{value: 'remove', label: 'Remove a server'}] : []),
                {value: 'test', label: 'Test again'},
                {value: 'done', label: 'Done'},
            ],
            initialValue: servers.length ? 'done' : 'add',
        }))
        if (action === 'done') return
        if (action === 'add') await addComfy(entries)
        if (action === 'remove') {
            const index = answer(await p.select({
                message: 'Remove which server?',
                options: servers.map((s, i) => ({value: i, label: s.name, hint: s.url})),
            }))
            entries.splice(index, 1)
            if (entries.length) file.comfy = entries
            else delete file.comfy
            await save(`the servers (${servers[index]!.name} removed)`)
        }
    }
}

async function showComfyStatus(servers: ComfyServer[]) {
    if (!servers.length) return log.info(`No servers saved - ${defaultComfy} is used`)
    const spinner = p.spinner()
    spinner.start(`Testing ${servers.length} server(s)`)
    const results = await Promise.all(servers.map(s => probeComfy(s).then(describeDevices, (e: Error) => new Error(e.message))))
    spinner.stop(`${results.filter(r => !(r instanceof Error)).length} of ${servers.length} reachable`)
    const lines = servers.map((s, i) => {
        const result = results[i]!
        const auth = s.credentials ? styles.muted(s.credentials.type === 'basic' ? ' (password)' : ' (token)') : ''
        return `${result instanceof Error ? '✗' : '✓'} ${s.name}  ${styles.muted(s.url)}${auth}\n    ${result instanceof Error ? `unreachable - ${result.message}` : result}`
    })
    p.note(lines.join('\n'), 'Servers')
}

async function addComfy(entries: ComfyEntry[]) {
    const url = normalizeUrl(answer(await p.text({
        message: 'URL',
        placeholder: defaultComfy,
        validate: validateUrl,
    })), 'URL')
    const host = new URL(url).host
    const name = answer(await p.text({
        message: 'Name - shown in the log and used in the client id',
        placeholder: host,
        defaultValue: host,
        validate: value => !value || /^[\w.:-]+$/.test(value) ? undefined : 'only letters, digits, ".", ":", "_" and "-"',
    })) || host
    const auth = answer(await p.select({
        message: 'Authentication',
        options: [
            {value: 'none', label: 'None'},
            {value: 'token', label: 'Bearer token'},
            {value: 'basic', label: 'Username and password'},
        ],
    }))
    const entry: Exclude<ComfyEntry, string> = {url, ...(name !== host ? {name} : {})}
    if (auth === 'token') entry.token = answer(await p.password({message: 'Token', validate: v => v ? undefined : 'required'}))
    if (auth === 'basic') {
        entry.username = answer(await p.text({message: 'Username', validate: v => v ? undefined : 'required'}))
        entry.password = answer(await p.password({message: 'Password', validate: v => v ? undefined : 'required'}))
    }

    const [server] = parseComfyEntries([entry], 'new server')
    const spinner = p.spinner()
    spinner.start(`Testing ${url}`)
    try {
        spinner.stop(`${server!.name}: ${describeDevices(await probeComfy(server!))}`)
    } catch (e) {
        spinner.error(`${server!.name}: ${(e as Error).message}`)
        if (!answer(await p.confirm({message: 'The server does not answer - save anyway?', initialValue: false}))) return
    }
    // a plain URL stays a plain string in the file
    entries.push(entry.name || entry.token || entry.username ? entry : url)
    file.comfy = entries
    await save(`the server ${server!.name}`)
}

async function show() {
    const path = settingsPath()
    const {llm, comfy, sources} = await loadSettings()
    const source = (s: Source) => styles.muted(`(${s === 'file' ? 'settings file' : s})`)
    log.info(`Settings file: ${path}${existsSync(path) ? '' : styles.muted(' (none yet - run: bun run setup)')}\n`)
    log.info('LLM')
    log.info(`  url      ${llm.url ?? styles.muted('not set')} ${source(sources.llmUrl)}`)
    log.info(`  api key  ${llm.apiKey ? maskSecret(llm.apiKey) : styles.muted('none')} ${source(sources.llmApiKey)}`)
    log.info(`  model    ${llm.model ?? styles.muted('not set - the server\'s only model')} ${source(sources.llmModel)}`)
    log.info(`  parallel ${llm.parallel} ${styles.muted(llm.parallel > 1 ? 'calls at once' : 'call at a time')} ${source(sources.llmParallel)}`)
    log.info('\nVision (describing pictures)')
    if (!llm.vision) log.info(`  ${styles.muted('the text model')}`)
    else {
        log.info(`  url      ${llm.vision.url ?? styles.muted('the text server')} ${source(sources.visionUrl)}`)
        if (llm.vision.url) log.info(`  api key  ${llm.vision.apiKey ? maskSecret(llm.vision.apiKey) : styles.muted('none')} ${source(sources.visionApiKey)}`)
        log.info(`  model    ${llm.vision.model ?? styles.muted('not set - the server\'s only model')} ${source(sources.visionModel)}`)
    }
    log.info(`\nComfyUI ${source(sources.comfy)}`)
    for (const server of comfy) {
        const auth = server.credentials?.type === 'bearer_token' ? ` token ${maskSecret(server.credentials.token)}`
            : server.credentials?.type === 'basic' ? ` user ${server.credentials.username}, password ${maskSecret(server.credentials.password)}` : ''
        log.info(`  ${server.name.padEnd(20)} ${server.url}${styles.muted(auth)}`)
    }
    log.info(styles.muted('\nOverrides, lowest first: settings file → project config.json ("llm": {"model": …}) → env vars → flags'))
}

function printWithoutTerminal() {
    const example: SettingsFile = {
        llm: {url: 'http://localhost:8080/v1', apiKey: '…', model: '<model id>', vision: {url: 'http://localhost:8081/v1', model: '<vision model id>'}},
        comfy: [defaultComfy, {url: 'https://gpu2.lan:8188', name: 'gpu2', token: '…'}],
    }
    log.info(`No terminal to ask in - set the values instead:

  env vars:   FEVERSLOP_LLM_URL=http://localhost:8080/v1
              FEVERSLOP_LLM_API_KEY=…
              FEVERSLOP_LLM_MODEL=<model id>
              FEVERSLOP_LLM_PARALLEL=2     (as many calls at once as the server has slots, default 1)
              FEVERSLOP_VISION_URL=http://localhost:8081/v1   (describing pictures - default: the text server)
              FEVERSLOP_VISION_API_KEY=…
              FEVERSLOP_VISION_MODEL=<vision model id>       (default: the text model)
              FEVERSLOP_COMFY=http://localhost:8188,http://gpu2.lan:8188

  per run:    bun index.ts --llm-url=… --llm-model=… --llm-parallel=2 --comfy=http://a:8188,http://b:8188

  or write ${settingsPath()}:
${JSON.stringify(example, null, 2).replace(/^/gm, '    ')}`)
}
