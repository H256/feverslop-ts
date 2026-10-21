import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Looks through the rendered clips of a project for the ones that came out as the reference pictures lined up on
// their grey studio backdrop (see lib/leak.ts), and prints the command that renders just those again. Runs nothing
// on ComfyUI.
// usage: bun run leak-scan <project-id>
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {backdropSeconds, hasBackdropRun} from "../lib/leak.ts";
import {styles} from "../lib/log.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
cli('leak-scan')


const [id] = Bun.argv.slice(2)
if (!id || !projectExists(id)) {
    log.error(`usage: bun run leak-scan <project-id>${id ? `\nprojects/${id} does not exist` : ''}`)
    process.exit(1)
}
const videos = join(projectDir(id), 'videos')
const files = existsSync(videos) ? readdirSync(videos).filter(f => /^slot-\d+\.mp4$/.test(f)).sort() : []
if (!files.length) {
    log.error(`${videos} has no rendered clips - render them first: bun index.ts ${id} --render=videos`)
    process.exit(1)
}

const leaked: string[] = []
for (const file of files) {
    const seconds = await backdropSeconds(join(videos, file))
    const clip = file.replace(/\.mp4$/, '')
    if (!hasBackdropRun(seconds)) continue
    leaked.push(clip)
    log.info(`${styles.name(clip)}  ${seconds.length} sample(s) on a grey backdrop, ${seconds[0]!.toFixed(1)}-${seconds.at(-1)!.toFixed(1)} s`)
}
log.info(`${files.length} clips looked at, ${leaked.length} with a grey studio backdrop`)
if (leaked.length) {
    log.info(`\nrender them again (needs "seed": -1 in config.json, the old ones are kept in old/attempts/):`)
    log.info(`bun index.ts ${id} --render=videos --only=${leaked.join(',')} --again`)
}
