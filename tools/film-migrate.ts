import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Carries rendered clips over to a changed plan: a clip whose prompt and length are the same as in the old plan keeps its video, under its new number
// (a plan that got another shot or another split renumbers the clips). A clip that goes on from the last frame of the one before is only kept when that
// one is carried over too - it starts from that frame.
//
// The old state is a copy of the film folder (output/clips/*.json, videos/ and assets/clips/ with the boundary frames) - put away BEFORE the plan was
// changed. Without --apply only the result is shown; with --apply the videos of the film are replaced by the carried-over ones (the copy keeps everything).
// usage: bun run film:migrate <film-id> <folder-with-the-old-state> [--apply]
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {promptHash} from "../lib/film/render.ts";
import {filmDir} from "../lib/film/setup.ts";
cli('film:migrate')


type Request = { id: string, prompt: string, frames: number, frameStart: number, startsFrom?: string }
const [id, oldArg, ...flags] = process.argv.slice(2)
if (!id || !oldArg) {
    log.error('usage: bun run film:migrate <film-id> <folder-with-the-old-state> [--apply]')
    process.exit(1)
}
const film = filmDir(id)
const old = resolve(oldArg)
if (old === resolve(film)) {
    log.error('the old state must be a copy of the film folder, not the folder itself')
    process.exit(1)
}
const apply = flags.includes('--apply')
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const requests = (dir: string): Request[] => existsSync(dir) ? readdirSync(dir).filter(f => /^clip-\d+\.json$/.test(f)).sort().map(f => read(join(dir, f))) : []

const oldRequests = requests(join(old, 'output/clips'))
const newRequests = requests(join(film, 'output/clips'))
if (!oldRequests.length || !newRequests.length) {
    log.error(`no clip requests in ${!oldRequests.length ? old : film} - plan the film first (output/clips/clip-001.json ...)`)
    process.exit(1)
}

// the rendered clips of the old state, by the hash of the prompt they were rendered from
const oldByHash = new Map<string, Request[]>()
for (const r of oldRequests) {
    const meta = join(old, `videos/${r.id}.mp4.json`)
    if (!existsSync(join(old, `videos/${r.id}.mp4`)) || !existsSync(meta)) continue
    const hash = read(meta).promptHash
    oldByHash.set(hash, [...(oldByHash.get(hash) ?? []), r])
}
// new -> old in order, every old clip used once
const pair = new Map<string, Request>()
for (const r of newRequests) {
    const found = oldByHash.get(promptHash(r))?.shift()
    if (found) pair.set(r.id, found)
}
const keep = new Map<string, Request>()
const dropped: string[] = []
for (const r of newRequests) {
    const was = pair.get(r.id)
    if (!was) continue
    const sameStart = !r.startsFrom && !was.startsFrom || (r.startsFrom && was.startsFrom && keep.get(r.startsFrom)?.id === was.startsFrom)
    sameStart ? keep.set(r.id, was) : dropped.push(`${r.id} (was ${was.id}: another clip before it)`)
}

log.info(`${newRequests.length} clips in the plan, ${keep.size} can be carried over, ${newRequests.length - keep.size} to render`)
if (dropped.length) log.info(`not carried over because the clip before it changed:\n${dropped.map(d => `  ${d}`).join('\n')}`)
log.info('to render:', newRequests.filter(r => !keep.has(r.id)).map(r => r.id).join(' ') || 'nothing')
if (!apply) {
    log.info('(nothing is changed - run again with --apply)')
    process.exit(0)
}

const videos = join(film, 'videos')
const frames = join(film, 'assets/clips')
rmSync(videos, {recursive: true, force: true})
mkdirSync(videos, {recursive: true})
if (existsSync(frames)) for (const f of readdirSync(frames)) rmSync(join(frames, f))
mkdirSync(frames, {recursive: true})
for (const [newId, was] of keep) {
    const n = newRequests.find(r => r.id === newId)!
    copyFileSync(join(old, `videos/${was.id}.mp4`), join(videos, `${newId}.mp4`))
    writeFileSync(join(videos, `${newId}.mp4.json`), JSON.stringify({...read(join(old, `videos/${was.id}.mp4.json`)), frameStart: n.frameStart, frames: n.frames, request: `output/clips/${newId}.json`}, null, 2))
    for (const suffix of ['_lf.png', '_ff.png']) {
        const from = [join(old, `assets/clips/${was.id}${suffix}`), join(old, `clips-frames/${was.id}${suffix}`)].find(existsSync)
        if (from) copyFileSync(from, join(frames, `${newId}${suffix}`))
    }
}
// the assembled film is built from clips that are not all there any more
rmSync(join(film, `${id}.mp4`), {force: true})
log.next(`bun film.ts ${id} --render=videos`)
