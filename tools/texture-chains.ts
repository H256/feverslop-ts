import {cli} from '../lib/cli.ts';
// Measures whether continuing clips get grittier from link to link (#478): the fine detail of every rendered clip
// (lib/texture.ts), each chain of clips that start on the clip before shown relative to its first clip, and the change
// at every join next to the change at an ordinary cut - the cuts are the yardstick of how much clips differ anyway.
// Reads the raw clips in videos/ with ffmpeg only - no ComfyUI, no LLM, nothing is written.
// usage: bun run texture-chains <project-id> [--film] [--json]
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {probeVideo} from "../lib/assemble.ts";
import {clipChains} from "../lib/batch.ts";
import {jsonOutput, log, styles} from "../lib/log.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import {readClipRequests} from "../lib/render-state.ts";
import {clipTexture, median, perLink, type Texture} from "../lib/texture.ts";
import {filmDir, filmExists} from "../lib/film/setup.ts";
cli('texture-chains')

const usage = 'usage: bun run texture-chains <project-id> [--film] [--json]'
const isFilm = Bun.argv.includes('--film')
const [id] = Bun.argv.slice(2).filter(a => !a.startsWith('--'))
if (!id || !(isFilm ? filmExists(id) : projectExists(id))) log.usageError(id ? `No ${isFilm ? 'film' : 'project'} "${id}"` : 'Which project?', usage)
const dir = isFilm ? filmDir(id!) : projectDir(id!)

type Clip = { id: string, startsFrom?: string }
const requests = (await readClipRequests<Clip>(dir)).filter(c => existsSync(join(dir, 'videos', `${c.id}.mp4`)))
if (!requests.length) log.usageError(`${dir} has no rendered clips with a plan`, usage)

// how a clip goes on from the one before: on its context frames, on its last frame, or not at all (a cut). The sidecar
// says so; a music video's clip rendered before its sidecar kept contextFrames is known by the tail of the clip before
// (assets/clips/<id>_tail<N>.mp4, cut for its job) - there, and no newer than the clip
const clipsAssets = join(dir, 'assets', 'clips')
const tails = existsSync(clipsAssets) ? readdirSync(clipsAssets).filter(f => /_tail\d+\.mp4$/.test(f)) : []
const joinOf = (clip: Clip): 'context' | 'last frame' | 'cut' => {
    if (!clip.startsFrom) return 'cut'
    const video = join(dir, 'videos', `${clip.id}.mp4`)
    try {
        const sidecar = JSON.parse(readFileSync(`${video}.json`, 'utf8')) as { contextFrames?: number }
        if (Number.isInteger(sidecar.contextFrames)) return 'context'
    } catch {
        // no sidecar: judged by the tail alone
    }
    const tail = tails.find(f => f.startsWith(`${clip.startsFrom}_tail`))
    return tail && statSync(join(clipsAssets, tail)).mtimeMs <= statSync(video).mtimeMs ? 'context' : 'last frame'
}

const textures = new Map<string, Texture>()
for (const clip of requests) {
    const file = join(dir, 'videos', `${clip.id}.mp4`)
    textures.set(clip.id, await clipTexture(file, await probeVideo(file)))
    if (!jsonOutput()) process.stderr.write(`\r${textures.size}/${requests.length} clips measured`)
}
if (!jsonOutput()) process.stderr.write('\n')

// every pair of neighbours: the ratio of the later one to the earlier one, by how it goes on
const joins = requests.slice(1).map((clip, i) => {
    const before = requests[i]!
    const kind = clip.startsFrom === before.id ? joinOf(clip) : 'cut'
    const a = textures.get(before.id)!, b = textures.get(clip.id)!
    return {from: before.id, to: clip.id, kind, fine: b.fine / a.fine, structure: b.structure / a.structure}
})
const chains = clipChains(requests).filter(c => c.length > 1).map(chain => ({
    clips: chain.map(c => ({id: c.id, join: c === chain[0] ? 'start' : joinOf(c), ...textures.get(c.id)!})),
    perLink: {fine: perLink(chain.map(c => textures.get(c.id)!.fine)), structure: perLink(chain.map(c => textures.get(c.id)!.structure))},
}))
const geomean = (values: number[]) => values.length ? Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length) : NaN
const summary = (['context', 'last frame', 'cut'] as const).map(kind => {
    const of = joins.filter(j => j.kind === kind)
    return {kind, joins: of.length, fine: {median: of.length ? median(of.map(j => j.fine)) : NaN, mean: geomean(of.map(j => j.fine))}, structure: {median: of.length ? median(of.map(j => j.structure)) : NaN, mean: geomean(of.map(j => j.structure))}}
})

if (jsonOutput()) {
    log.json({[isFilm ? 'film' : 'project']: id, clips: Object.fromEntries(textures), chains, joins, summary})
    process.exit(0)
}

const x = (v: number) => Number.isFinite(v) ? `x${v.toFixed(3)}` : '-'
log.section(`CHAINS · ${chains.length} of continuing clips · relative to their first clip`)
if (!chains.length) log.info(styles.muted('no clip starts on the one before it - nothing to compare'))
for (const chain of chains) {
    const [first] = chain.clips
    log.info(`${styles.name(chain.clips.map(c => c.id).join(' → '))} ${styles.muted(`per link: fine ${x(chain.perLink.fine)}, structure ${x(chain.perLink.structure)}`)}`)
    for (const clip of chain.clips) log.info(`   ${clip.id.padEnd(10)} ${clip.join.padEnd(10)} fine ${x(clip.fine / first!.fine).padEnd(8)} structure ${x(clip.structure / first!.structure)}`)
}
log.section('JOINS · the later clip against the one before it')
for (const s of summary) log.info(`${s.kind.padEnd(10)} ${String(s.joins).padStart(3)} joins   fine median ${x(s.fine.median).padEnd(8)} mean ${x(s.fine.mean).padEnd(8)}   structure median ${x(s.structure.median).padEnd(8)} mean ${x(s.structure.mean)}`)
log.info(styles.muted('a ratchet shows as continuing joins clearly above 1 while the cuts stay around it - reported elsewhere: about x1.3 per join'))
