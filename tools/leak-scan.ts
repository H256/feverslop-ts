import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Looks through the rendered clips of a project for the ones that came out as the reference pictures lined up on
// their grey studio backdrop (see lib/leak.ts), and prints the command that renders just those again. Runs nothing
// on ComfyUI. What it finds is kept in output/leak-scan.json, with the file it was found in - for the workspace.
// usage: bun run leak-scan <project-id> [--film]   (--film: a film in films/)
import {existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {backdropSeconds, hasBackdropRun} from "../lib/leak.ts";
import {styles} from "../lib/log.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import {filmDir, filmExists} from "../lib/film/setup.ts";
cli('leak-scan')


const isFilm = Bun.argv.includes('--film')
const [id] = Bun.argv.slice(2).filter(a => a !== '--film')
if (!id || !(isFilm ? filmExists(id) : projectExists(id))) {
    log.error(`usage: bun run leak-scan <project-id> [--film]${id ? `\n${isFilm ? 'films' : 'projects'}/${id} does not exist` : ''}`)
    process.exit(1)
}
const dir = isFilm ? filmDir(id) : projectDir(id)
const run = `bun ${isFilm ? 'film.ts' : 'index.ts'} ${id}`
const videos = join(dir, 'videos')
const files = existsSync(videos) ? readdirSync(videos).filter(f => /^(slot|clip)-\d+\.mp4$/.test(f)).sort() : []
if (!files.length) {
    log.error(`${videos} has no rendered clips - render them first: ${run} --render=videos`)
    process.exit(1)
}

const leaked: string[] = []
const found: Record<string, { video: number, from: number, to: number, samples: number }> = {}
for (const file of files) {
    const seconds = await backdropSeconds(join(videos, file))
    const clip = file.replace(/\.mp4$/, '')
    if (!hasBackdropRun(seconds)) continue
    leaked.push(clip)
    found[clip] = {video: Math.round(statSync(join(videos, file)).mtimeMs), from: seconds[0]!, to: seconds.at(-1)!, samples: seconds.length}
    log.info(`${styles.name(clip)}  ${seconds.length} sample(s) on a grey backdrop, ${seconds[0]!.toFixed(1)}-${seconds.at(-1)!.toFixed(1)} s`)
}
mkdirSync(join(dir, 'output'), {recursive: true})
writeFileSync(join(dir, 'output', 'leak-scan.json'), JSON.stringify({at: new Date().toISOString(), clips: found}, null, 2))
log.info(`${files.length} clips looked at, ${leaked.length} with a grey studio backdrop`)
if (leaked.length) {
    log.info(`\nrender them again (needs "seed": -1 in config.json, the old ones are kept in old/attempts/):`)
    log.info(`${run} --render=videos --only=${leaked.join(',')} --again`)
}
