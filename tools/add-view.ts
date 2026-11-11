import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
import {log, styles} from '../lib/log.ts'
// One more view of a place of a film, for where its sheet has none that fits (the reverse side, a close-up of a feature): rendered as one
// move from the place's anchor, or from another of its views (--from=<n>), so the look stays the same. One move reaches about a quarter
// turn; a view that looks back the other way invents the place anew (#532) - so the turn is judged first, and such a view is reached in
// two moves, through a view in between that is kept as well. A clip takes a view through its choice of view (clip-overrides/).
// usage: bun run add-view <film-id> <location-id> --name=<where the camera is> --shows=<what is seen from there> [--from=<view>] [--comfy=URL]
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {lockProject} from '../lib/lock.ts'
import {loadSettings} from '../lib/settings.ts'
import {configureLlm} from '../lib/llm.ts'
import {loadFilmConfig} from '../lib/film/config.ts'
import {filmRenderConfig} from '../lib/film/pictures.ts'
import {FilmRenderer} from '../lib/film/render.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import type {FilmProject} from '../lib/film/types.ts'
import {nextViewNumber, placeViews, viewRoute} from '../lib/film/views.ts'
import {sequenceSheetDir, sheetAnchor} from '../lib/sequenceSheet.ts'
import {libraryIdPattern} from '../lib/library.ts'
cli('add-view')

const usage = 'usage: bun run add-view <film-id> <location-id> --name=<where the camera is> --shows=<what is seen from there> [--from=<view>] [--comfy=URL]'
const args = Bun.argv.slice(2)
const flag = (name: string) =>
    args
        .find(a => a.startsWith(`--${name}=`))
        ?.slice(name.length + 3)
        ?.trim()
const [id, locationId] = args.filter(a => !a.startsWith('--'))
const name = flag('name')
const shows = flag('shows')
if (!id || !locationId || !name || !shows) log.usageError('Which film, which place, and what the view shows?', usage)
if (!libraryIdPattern.test(locationId!)) log.usageError(`Invalid location id "${locationId}" - use lowercase letters, digits and dashes`, usage)
if (!filmExists(id!)) log.usageError(noProject('film', id, filmIds()), usage)
const dir = filmDir(id!)
const anchor = sheetAnchor(sequenceSheetDir('location', locationId!))
if (!existsSync(join(dir, anchor)))
    log.usageError(`${locationId} has no anchor picture to start from (${anchor}) - render its sheet first: bun film.ts ${id} --render=images`, usage)

// where the move starts: the anchor - the first view of the sheet - or the view asked for
const data = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as FilmProject
const views = placeViews(dir, data, locationId!)
const fromNumber = flag('from') === undefined ? undefined : Number(flag('from'))
if (fromNumber !== undefined && !(Number.isInteger(fromNumber) && fromNumber >= 1 && fromNumber <= views.length)) {
    log.usageError(`--from must be one of the views of ${locationId}: ${views.map((v, n) => `${n + 1} ${v.name}`).join(' · ') || 'it has none yet'}`, usage)
}
const start = fromNumber
    ? views[fromNumber - 1]!
    : {...(views[0] ?? {name: 'where the anchor picture is taken', shows: data.locationDescriptions?.[locationId!] ?? ''}), file: anchor}
if (!existsSync(join(dir, start.file))) log.usageError(`View ${fromNumber} of ${locationId} has no picture yet (${start.file})`, usage)

lockProject(dir, `film ${id}`)
const config = await loadFilmConfig(dir)
const settings = await loadSettings({projectModel: config.llm.model, comfy: flag('comfy')})
configureLlm(settings.llm)
const place = data.locationDescriptions?.[locationId!] ?? data.cast?.locations.find(l => l.id === locationId)?.description ?? locationId!
const {steps, turn} = await viewRoute(place, start, {name: name!, shows: shows!})
if (steps.length > 1)
    log.step(
        'Two moves',
        `${styles.muted('it looks back the other way, which one move does not reach - first')} ${steps[0]!.name}, ${styles.muted('then the view asked for')}`,
    )
else if (turn === 'unknown')
    log.warn(
        'how far the camera turns could not be judged - the view is rendered in one move; a view that looks back the other way may come out as another place',
    )

using renderer = new FilmRenderer(`film-${id}`, dir, filmRenderConfig(config), settings.comfy)
let from = start.file
let file = ''
for (const step of steps) {
    const n = nextViewNumber(dir, locationId!)
    file = await renderer.renderExtraView(locationId!, n, step.name, step.shows, from)
    log.info(
        `View ${n} of ${locationId} is ${file}${step === steps.at(-1) ? ' - a clip takes it through its choice of view' : ' - the view in between, kept as well'}`,
    )
    from = file
}
log.output(join(dir, file))
