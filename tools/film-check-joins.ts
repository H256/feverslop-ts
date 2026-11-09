import {cli} from '../lib/cli.ts'
// The cuts within a scene, checked by a model that reads pictures: the last frame of a clip against the first of the next. It only
// says what it finds - the clips to render again are named with the command to do it, nothing is rendered on its own.
// usage: bun run film:check-joins <film-id> [--only=clip-004,clip-007] [--again]     (--only: the joins into these clips; --again: ask again)
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {parseArgs} from 'node:util'
import {visionUrls} from '../lib/describe-picture.ts'
import {askJson, configureLlm, picturesReadable} from '../lib/llm.ts'
import {lockProject} from '../lib/lock.ts'
import {log, styles} from '../lib/log.ts'
import {readClipRequests} from '../lib/render-state.ts'
import {loadSettings} from '../lib/settings.ts'
import type {FilmClipRequest} from '../lib/film/compose.ts'
import {loadFilmConfig} from '../lib/film/config.ts'
import {cutsOf, joinFingerprint, joinFrames, joinPrompt, type JoinRecord, plannedChanges, readVerdict} from '../lib/film/joins.ts'
import {filmDir, filmExists} from '../lib/film/setup.ts'
import {FilmStore} from '../lib/film/store.ts'
cli('film:check-joins')

const usage = 'usage: bun run film:check-joins <film-id> [--only=clip-004,clip-007] [--again]'
const {
    values: args,
    positionals: [id],
} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {only: {type: 'string', default: ''}, again: {type: 'boolean', default: false}},
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
if (!id || !filmExists(id)) log.usageError(id ? `No film "${id}" in films/` : 'Which film?', usage)
const dir = filmDir(id!)
lockProject(dir, `film ${id}`)

const film = new FilmStore(id!)
await film.load()
const stagings = Object.fromEntries((film.data.coverage ?? []).map(c => [c.sceneId, c.staging ?? '']))
const requests = await readClipRequests<FilmClipRequest>(dir)
if (!requests.length) log.usageError(`${id} has no clips planned yet - bun film.ts ${id}`, usage)
const only = new Set(args.only.split(',').filter(Boolean))
const unknown = [...only].filter(clip => !requests.some(r => r.id === clip))
if (unknown.length) log.usageError(`--only: no clip ${unknown.join(', ')}`, usage)
const cuts = cutsOf(requests).filter(cut => !only.size || only.has(cut.to))

const config = await loadFilmConfig(dir)
const settings = await loadSettings({projectModel: config.llm.model})
configureLlm(settings.llm)
if (!(await picturesReadable())) log.usageError('this needs a model that reads pictures - bun run setup vision', usage)

const file = join(dir, 'output', 'join-check.json')
const records: Record<string, JoinRecord> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const keyOf = (cut: {from: string; to: string}) => `${cut.from}>${cut.to}`
log.section(`JOINS · ${cuts.length} cut(s) within a scene`)
const flagged: string[] = []
let missing = 0
for (const cut of cuts) {
    const changes = plannedChanges(
        requests.find(r => r.id === cut.from)!,
        requests.find(r => r.id === cut.to)!,
    )
    const fingerprint = joinFingerprint(dir, cut, stagings[cut.sceneId] ?? '', changes)
    if (!fingerprint) {
        missing++
        log.step('Skipped', styles.muted(`${cut.from} → ${cut.to}: not rendered yet`))
        continue
    }
    let record = records[keyOf(cut)]
    if (args.again || record?.fingerprint !== fingerprint) {
        const images = await visionUrls(joinFrames(cut).map(f => join(dir, f)))
        record = {...readVerdict(await askJson(joinPrompt(images, stagings[cut.sceneId] ?? '', changes))), fingerprint}
        records[keyOf(cut)] = record
        writeFileSync(file, JSON.stringify(records, null, 2) + '\n')
    }
    if (record.fits) log.step('Fits', styles.muted(`${cut.from} → ${cut.to}`))
    else {
        flagged.push(cut.to)
        log.warn(`${cut.from} → ${cut.to}: ${record.differences.join(' · ')}`)
    }
}
log.step('Saved', styles.muted(file))
if (missing) log.info(`${missing} cut(s) not checked: a clip on one side is not rendered yet`)
// a judgement of a model on two pictures: worth a look, not a reason to spend a render without one
if (flagged.length)
    log.info(`Look at them, and render the ones that are wrong again: bun film.ts ${id} --render=videos --only=${[...new Set(flagged)].join(',')} --again`)
else if (cuts.length) log.info('No differences found at the cuts')
