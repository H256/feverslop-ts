// Views test of a location: which image-edit model makes the other sides of a place best? The designed views of a film's location (the step
// locationViews, config locationViews: true) are made from the hero picture by each of the setups below, saved next to each other:
//   films/<id>/views-test/<location>/<setup>/view-2.png ... view-5.png and comparison.png (a row per setup: hero, then the four views)
// Nothing is rendered unless this is run: one picture is 5-60 s of GPU. The pictures are not used by the film - this only shows which setup is
// worth building into the film.
// usage: bun run film:views-test <film-id> [location-id] [--setups=klein,angles,nextscene] [--seed=42] [--comfy=http://host:8188]
import {existsSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import type {EditWorkflow} from "../comfy/helpers.ts";
import flux2Klein from "../comfy/workflows/edit-flux2-klein.ts";
import {qwenAngles, qwenNextScene} from "../comfy/workflows/edit-qwen.ts";
import {loadFilmConfig} from "../lib/film/config.ts";
import {filmRenderConfig} from "../lib/film/pictures.ts";
import {FilmRenderer} from "../lib/film/render.ts";
import {filmExists} from "../lib/film/setup.ts";
import {FILMS_DIR} from "../lib/film/store.ts";
import type {FilmProject, LocationView} from "../lib/film/types.ts";
import {log, printBanner, styles} from "../lib/log.ts";
import {composeSheet} from "../lib/sequenceSheet.ts";
import {loadSettings} from "../lib/settings.ts";

type Setup = { id: string, name: string, workflow: EditWorkflow, prompt: (view: LocationView, index: number) => string }

// what the view is asked for, in the way each model wants it
const KEEP = 'Keep the style, the light, the time of day, the weather, the materials and every feature of the place exactly as in the picture; no people.'
const angle = [
    '',
    'Rotate the camera 180 degrees so that it looks back the opposite way. (将镜头旋转180度，转向相反方向)',
    'Rotate the camera 90 degrees to the left. (将镜头向左旋转90度)',
    'Rotate the camera 90 degrees to the right. (将镜头向右旋转90度)',
    'Turn the camera to a high wide-angle view looking down at the whole place. (将镜头转为俯视广角镜头)',
]
const SETUPS: Setup[] = [
    {id: 'klein', name: 'FLUX.2 Klein 4B', workflow: flux2Klein, prompt: v => `Show this same place from a different camera position. ${KEEP} New camera position: ${v.name}. ${v.shows}`},
    {id: 'angles', name: 'Qwen-Edit 2509 + Multiple angles', workflow: qwenAngles, prompt: (v, i) => `${angle[i]} ${v.shows} ${KEEP}`},
    {id: 'nextscene', name: 'Qwen-Edit 2511 + Next Scene', workflow: qwenNextScene, prompt: v => `Next Scene: ${v.name}. ${v.shows} ${KEEP}`},
]

printBanner()
const {values: args, positionals} = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {setups: {type: 'string', default: SETUPS.map(s => s.id).join(',')}, seed: {type: 'string', default: '42'}, comfy: {type: 'string'}},
})
const usage = `usage: bun run film:views-test <film-id> [location-id] [--setups=${SETUPS.map(s => s.id).join(',')}] [--seed=42] [--comfy=http://host:8188]`
const [filmId, locationArg] = positionals
if (!filmId || !filmExists(filmId)) log.usageError(`${filmId ? `no film "${filmId}"` : 'no film id given'}`, usage)
const dir = join(FILMS_DIR, filmId!)
const project: FilmProject = await Bun.file(join(dir, 'project.json')).json()

const locations = project.cast?.locations ?? []
const location = locationArg ? locations.find(l => l.id === locationArg) : locations[0]
if (!location) log.usageError(`no location${locationArg ? ` "${locationArg}"` : ''} - the film has: ${locations.map(l => l.id).join(', ') || 'none'}`, usage)
const views = project.locationViews?.[location!.id]
if (!views || views.length !== 5) {
    log.usageError(`${location!.id} has no designed views yet - put {"locationViews": true} into films/${filmId}/config.json and run: bun film.ts ${filmId} --redo=locationViews`, usage)
}
const chosen = args.setups!.split(',').filter(Boolean).map(id => SETUPS.find(s => s.id === id) ?? log.usageError(`unknown setup "${id}" - use ${SETUPS.map(s => s.id).join(', ')}`, usage))
const seed = Number(args.seed)
if (!Number.isInteger(seed) || seed < 0) log.usageError('--seed must be a whole number', usage)

// the hero picture: the anchor image of the sheet (a single picture); the sheet itself is five panels
const anchor = join(dir, 'assets', 'sequence', 'locations', location!.id, 'anchor.png')
const picture = join(dir, 'assets', 'locations', `${location!.id}.png`)
const hero = existsSync(anchor) ? anchor : picture
if (!existsSync(hero)) log.usageError(`no picture of ${location!.id} yet - render it first: bun film.ts ${filmId} --render=images`, usage)
if (hero === picture) log.warn('only the location sheet exists (five panels in one picture) - the models edit it as it is; the anchor image is better: render the sheet again')

const config = await loadFilmConfig(dir)
const settings = await loadSettings({projectModel: config.llm.model, comfy: args.comfy})
log.section(`VIEWS TEST · ${filmId} · ${location!.id}`)
log.step('Hero', hero)
for (const [i, v] of views!.entries()) log.step(`View ${i + 1}`, `${styles.name(v.name)} ${styles.muted(i ? '' : '(the hero picture)')}`)
log.step('Setups', chosen.map(s => s.name).join(' · '))

using renderer = new FilmRenderer(`film-${filmId}`, dir, filmRenderConfig(config), settings.comfy)
const out = join(dir, 'views-test', location!.id)
const done: string[] = []
for (const setup of chosen) {
    log.section(setup.name.toUpperCase())
    try {
        for (let i = 1; i < 5; i++) {
            const target = join(out, setup.id, `view-${i + 1}.png`)
            const prompt = setup.prompt(views![i]!, i)
            log.step(`View ${i + 1}`, styles.muted(prompt.slice(0, 160)))
            await renderer.renderEdit(`${location!.id} ${setup.id} view ${i + 1}`, hero, target, setup.workflow, prompt, seed)
        }
        done.push(setup.id)
    } catch (e) {
        // a missing model or node is one setup that fails, not the whole test
        log.warn(`${setup.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
    // the next setup loads other models
    await renderer.freeMemory()
}

if (done.length) {
    // a row per setup: the hero, then its four views
    const paths = done.flatMap(id => [hero, ...[2, 3, 4, 5].map(n => join(out, id, `view-${n}.png`))])
    await composeSheet(paths, join(out, 'comparison.png'), {width: 512, height: 288}, 5)
    log.step('Comparison', `${join(out, 'comparison.png')} ${styles.muted(`- rows: ${done.map(id => SETUPS.find(s => s.id === id)!.name).join(' / ')}; columns: hero, then views 2-5`)}`)
}
if (done.length < chosen.length) log.warn(`not complete: ${chosen.filter(s => !done.includes(s.id)).map(s => s.name).join(', ')} - see the warnings above`)
