import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// One more view of a place of a film, for where its sheet has none that fits (the reverse side, a close-up of a feature): rendered from the
// place's anchor, so the look stays the same. A clip takes it through its choice of view (clip-overrides/, chosen in the workspace).
// usage: bun run add-view <film-id> <location-id> --name=<where the camera is> --shows=<what is seen from there> [--comfy=URL]
import {existsSync} from "node:fs";
import {join} from "node:path";
import {lockProject} from "../lib/lock.ts";
import {loadSettings} from "../lib/settings.ts";
import {loadFilmConfig} from "../lib/film/config.ts";
import {filmRenderConfig} from "../lib/film/pictures.ts";
import {FilmRenderer} from "../lib/film/render.ts";
import {filmDir, filmExists} from "../lib/film/setup.ts";
import {nextViewNumber} from "../lib/film/views.ts";
import {sequenceSheetDir, sheetAnchor} from "../lib/sequenceSheet.ts";
import {libraryIdPattern} from '../lib/library.ts';
cli('add-view')

const usage = 'usage: bun run add-view <film-id> <location-id> --name=<where the camera is> --shows=<what is seen from there> [--comfy=URL]'
const args = Bun.argv.slice(2)
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim()
const [id, locationId] = args.filter(a => !a.startsWith('--'))
const name = flag('name')
const shows = flag('shows')
if (!id || !locationId || !name || !shows) log.usageError('Which film, which place, and what the view shows?', usage)
if (!libraryIdPattern.test(locationId!)) log.usageError(`Invalid location id "${locationId}" - use lowercase letters, digits and dashes`, usage)
if (!filmExists(id!)) log.usageError(`No film "${id}" in films/`, usage)
const dir = filmDir(id!)
const anchor = sheetAnchor(sequenceSheetDir('location', locationId!))
if (!existsSync(join(dir, anchor))) log.usageError(`${locationId} has no anchor picture to start from (${anchor}) - render its sheet first: bun film.ts ${id} --render=images`, usage)
lockProject(dir, `film ${id}`)
const config = await loadFilmConfig(dir)
const settings = await loadSettings({projectModel: config.llm.model, comfy: flag('comfy')})
using renderer = new FilmRenderer(`film-${id}`, dir, filmRenderConfig(config), settings.comfy)
const n = nextViewNumber(dir, locationId!)
const file = await renderer.renderExtraView(locationId!, n, name!, shows!)
log.output(join(dir, file))
log.info(`View ${n} of ${locationId} is ${file} - a clip takes it through its choice of view`)
