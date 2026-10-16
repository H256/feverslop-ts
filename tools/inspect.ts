// One clip on one screen: the beat and the staged shots it comes from, its pictures and audio tracks, whether it is
// rendered (and from the request it has now), and the prompt itself. Read-only - no lock, no LLM, no ComfyUI.
// usage: bun run inspect <project-id> <clip-id>
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import type {ClipRequest} from "../lib/compose.ts";
import {loadProjectConfig} from "../lib/config.ts";
import {formatTime} from "../lib/frames.ts";
import {log, styles} from "../lib/log.ts";
import type {Project} from "../lib/project.ts";
import {projectDir, projectExists} from "../lib/project-setup.ts";
import {freshness} from "../lib/provenance.ts";
import {clipFingerprint} from "../lib/render.ts";
import {asBeatShots} from "../lib/shot-plan.ts";

const usage = 'usage: bun run inspect <project-id> <clip-id>'
const [id, clipId] = Bun.argv.slice(2)
if (!id || !projectExists(id)) log.usageError(id ? `No project "${id}" in projects/` : 'Which project?', usage)
const dir = projectDir(id!)
const clipsDir = join(dir, 'output', 'clips')
const clipIds = existsSync(clipsDir) ? readdirSync(clipsDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() : []
if (!clipIds.length) log.usageError(`${clipsDir} has no clip requests - plan the project first: bun index.ts ${id}`, usage)
if (!clipId || !clipIds.includes(clipId)) log.usageError(`${clipId ? `No clip "${clipId}"` : 'Which clip?'} - the clips are ${clipIds[0]} to ${clipIds.at(-1)}`, usage)

const clip: ClipRequest = await Bun.file(join(clipsDir, `${clipId}.json`)).json()
const data: Project = existsSync(join(dir, 'project.json')) ? await Bun.file(join(dir, 'project.json')).json() : {}
const config = await loadProjectConfig(dir)
const characters = data.cast?.characters ?? []
const nameOf = (characterId: string) => characters.find(c => c.id === characterId)?.name ?? characterId
const line = (label: string, value: string) => console.log(`${styles.label(label.padEnd(12))} ${value}`)

log.section(`${clip.id} · ${formatTime(clip.start)} – ${formatTime(clip.end)} · ${clip.section}`)
line('Length', `${clip.duration}s, ${clip.frames} frames from frame ${clip.frameStart}`)
if (clip.startsFrom) line('Goes on', `from the last frame of ${styles.name(clip.startsFrom)}`)

// the beat, and which of its staged shots are this clip's: the clips of a beat follow each other, so the shots of the
// clips of the same beat before this one come first
const beat = data.beats?.find(b => b.id === clip.beatId)
log.section(`BEAT ${clip.beatId}`)
if (beat) {
    line('Kind', `${beat.kind} · intensity ${beat.intensity} · ${beat.continuous ? 'one unbroken take' : 'cut'}`)
    line('Place', styles.name(beat.locationId))
    line('People', beat.characterIds.map(c => styles.name(nameOf(c))).join(', ') || styles.muted('nobody'))
    line('Summary', beat.summary)
    if (beat.stateAfter.length) line('After it', beat.stateAfter.join(' · '))
} else line('Beat', styles.warning(`${clip.beatId} is not in project.json any more - plan the project again`))

const plan = data.shotMoments?.[clip.beatId] && asBeatShots(data.shotMoments[clip.beatId]!)
if (plan) {
    const earlier = await Promise.all(clipIds.filter(other => other < clip.id).map(other => Bun.file(join(clipsDir, `${other}.json`)).json() as Promise<ClipRequest>))
    const offset = earlier.filter(c => c.beatId === clip.beatId).reduce((sum, c) => sum + c.shots.length, 0)
    log.section(`STAGED SHOTS ${offset + 1}-${offset + clip.shots.length} OF ${plan.shots.length}`)
    if (plan.staging) line('Staging', plan.staging)
    plan.shots.slice(offset, offset + clip.shots.length).forEach((shot, n) => {
        const cut = clip.shots[n]
        console.log(`${styles.name(cut?.label ?? `[Shot ${n + 1}]`)} ${styles.muted(`at ${cut?.at ?? '?'}s · ${shot.framing ?? cut?.framing ?? ''}${shot.hold ? ' · held' : ''}`)}`)
        console.log(`   ${shot.action}`)
        if (shot.characters?.length) console.log(styles.muted(`   in the picture: ${shot.characters.map(nameOf).join(', ')}`))
        for (const [person, p] of Object.entries(shot.people ?? {})) console.log(styles.muted(`   ${nameOf(person)}: ${[p.state, p.frame, p.motion].filter(Boolean).join(' | ')}`))
        if (shot.rest) console.log(styles.muted(`   the others: ${shot.rest}`))
    })
} else {
    log.section('SHOTS')
    for (const shot of clip.shots) console.log(`${styles.name(shot.label)} ${styles.muted(`at ${shot.at}s · ${shot.framing} · ${shot.camera}`)}`)
}

log.section('REFERENCES')
for (const picture of clip.assets.pictures) {
    const there = existsSync(join(dir, picture.file))
    console.log(`${styles.name(picture.label.padEnd(12))} ${picture.kind.padEnd(9)} ${picture.name.padEnd(24)} ${there ? styles.muted(picture.file) : styles.warning(`${picture.file} - missing`)}`)
}
for (const audio of clip.assets.audio) console.log(`${styles.name(audio.label.padEnd(12))} audio     ${(audio.stem ?? '').padEnd(24)} ${styles.muted(`${audio.songStart}s - ${audio.songEnd}s of the song`)}`)

log.section('RENDER')
const video = join(dir, 'videos', `${clip.id}.mp4`)
if (!existsSync(video)) line('Video', styles.muted(`not rendered - bun index.ts ${id} --render=videos --only=${clip.id}`))
else {
    const state = freshness(video, clipFingerprint(clip, dir, config))
    const sidecar = existsSync(`${video}.json`) ? await Bun.file(`${video}.json`).json() as Record<string, unknown> : {}
    line('Video', `${video} ${styles.muted([sidecar.workflow, sidecar.size, sidecar.seed !== undefined ? `seed ${sidecar.seed}` : ''].filter(Boolean).join(' · '))}`)
    line('Request', state === 'stale'
        ? styles.warning(`stale - made from another request than the plan has now (--render=videos --refresh=clips, or --only=${clip.id} --again)`)
        : state === 'current' ? 'current - made from this request' : styles.muted('not compared (your own file, or made before fingerprints)'))
}

log.box('Prompt', clip.prompt)
