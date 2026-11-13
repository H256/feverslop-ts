import {checkPrompt} from '../lib/prompt-check.ts'
import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
// One clip on one screen: the beat and the staged shots it comes from, its pictures and audio tracks, whether it is
// rendered (and from the request it has now), and the prompt itself. Read-only - no lock, no LLM, no ComfyUI.
// usage: bun run inspect <project-id> <clip-id> [--film]   (--film: a clip of a film in films/)
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import type {ClipRequest} from '../lib/compose.ts'
import {loadProjectConfig} from '../lib/config.ts'
import {formatTime} from '../lib/frames.ts'
import {jsonOutput, log, styles} from '../lib/log.ts'
import {factText, type Project} from '../lib/project.ts'
import {plainText} from '../lib/refs.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import {freshness} from '../lib/provenance.ts'
import {clipFingerprint} from '../lib/render.ts'
import {asBeatShots} from '../lib/shot-plan.ts'
import type {FilmClipRequest} from '../lib/film/compose.ts'
import {loadFilmConfig} from '../lib/film/config.ts'
import {filmRenderConfig} from '../lib/film/pictures.ts'
import {filmClipFreshness} from '../lib/film/render.ts'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import type {FilmProject} from '../lib/film/types.ts'
import {clipRequestsDir} from '../lib/previous-output.ts'
import {shownOf} from '../lib/text.ts'
cli('inspect')

const usage = 'usage: bun run inspect <project-id> <clip-id> [--film]'
const [id, clipId] = Bun.argv.slice(2).filter(a => a !== '--film')
if (Bun.argv.includes('--film')) {
    await inspectFilm(id, clipId)
    process.exit(0)
}
if (!id || !projectExists(id)) log.usageError(noProject('project', id, listProjects()), usage)
const dir = projectDir(id!)
const {clipsDir, clipIds} = requestedClip(dir, clipId, `project first: bun index.ts ${id}`)

const clip: ClipRequest = await Bun.file(join(clipsDir, `${clipId}.json`)).json()
const data: Project = existsSync(join(dir, 'project.json')) ? await Bun.file(join(dir, 'project.json')).json() : {}
const config = await loadProjectConfig(dir)
if (jsonOutput()) {
    const video = join(dir, 'videos', `${clip.id}.mp4`)
    log.json({
        project: id,
        clip,
        beat: data.beats?.find(b => b.id === clip.beatId) ?? null,
        plan: data.shotMoments?.[clip.beatId] ?? null,
        references: clip.assets.pictures.map(p => ({...p, exists: existsSync(join(dir, p.file))})),
        render: {file: video, state: existsSync(video) ? freshness(video, clipFingerprint(clip, dir, config)) : 'missing'},
    })
    process.exit(0)
}
const characters = data.cast?.characters ?? []
// the beats and plans write characters as {Name} - shown here with their plain names
const plain = (text: string) => plainText(text, characters)
const nameOf = (characterId: string) => characters.find(c => c.id === characterId)?.name ?? characterId

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
    line('Summary', plain(beat.summary))
    if (beat.stateAfter.length)
        line(
            'After it',
            beat.stateAfter.map(f => `${plain(factText(f))}${typeof f === 'object' && f.place ? styles.muted(' (of the place)') : ''}`).join(' · '),
        )
} else line('Beat', styles.warning(`${clip.beatId} is not in project.json any more - plan the project again`))

const plan = data.shotMoments?.[clip.beatId] && asBeatShots(data.shotMoments[clip.beatId]!)
if (plan) {
    const offset = await shotOffset<ClipRequest>(clipsDir, clipIds, clip.id, c => c.beatId === clip.beatId)
    log.section(`STAGED SHOTS ${offset + 1}-${offset + clip.shots.length} OF ${plan.shots.length}`)
    if (plan.staging) line('Staging', plain(plan.staging))
    plan.shots.slice(offset, offset + clip.shots.length).forEach((shot, n) => {
        const cut = clip.shots[n]
        log.info(
            `${styles.name(cut?.label ?? `[Shot ${n + 1}]`)} ${styles.muted(`at ${cut?.at ?? '?'}s · ${shot.framing ?? cut?.framing ?? ''}${shot.hold ? ' · held' : ''}`)}`,
        )
        log.info(`   ${plain(shot.action)}`)
        if (shot.characters?.length) log.info(styles.muted(`   in the picture: ${shot.characters.map(nameOf).join(', ')}`))
        for (const [person, p] of Object.entries(shot.people ?? {}))
            log.info(styles.muted(`   ${nameOf(person)}: ${[p.state, p.frame, p.motion].filter(Boolean).join(' | ')}`))
        if (shot.rest) log.info(styles.muted(`   the others: ${shot.rest}`))
    })
} else {
    log.section('SHOTS')
    for (const shot of clip.shots) log.info(`${styles.name(shot.label)} ${styles.muted(`at ${shot.at}s · ${shot.framing} · ${shot.camera}`)}`)
}

showReferences(dir, clip.assets.pictures)
for (const audio of clip.assets.audio)
    log.info(
        `${styles.name(audio.label.padEnd(12))} audio     ${(audio.stem ?? '').padEnd(24)} ${styles.muted(`${audio.songStart}s - ${audio.songEnd}s of the song`)}`,
    )

const video = join(dir, 'videos', `${clip.id}.mp4`)
await showRender(
    video,
    clip.id,
    `bun index.ts ${id}`,
    () => freshness(video, clipFingerprint(clip, dir, config)),
    () => [],
)

log.box('Prompt', clip.prompt)
for (const finding of checkPrompt(clip)) log.warn(`prompt: ${finding}`)

/** --film: one clip of a film - its scene, the planned shots it has, its dialogue, its pictures, whether it is rendered, its prompt. */
async function inspectFilm(id: string | undefined, clipId: string | undefined) {
    if (!id || !filmExists(id)) log.usageError(noProject('film', id, filmIds()), usage)
    const dir = filmDir(id!)
    const {clipsDir, clipIds} = requestedClip(dir, clipId, `film first: bun film.ts ${id}`)

    const clip: FilmClipRequest = await Bun.file(join(clipsDir, `${clipId}.json`)).json()
    const data: FilmProject = existsSync(join(dir, 'project.json')) ? await Bun.file(join(dir, 'project.json')).json() : {}
    const renderConfig = filmRenderConfig(await loadFilmConfig(dir))
    const video = join(dir, 'videos', `${clip.id}.mp4`)
    const coverage = data.coverage?.find(c => c.sceneId === clip.sceneId)
    // the clips of a scene follow each other: the shots of the clips of the same scene before this one come first
    const offset = await shotOffset<FilmClipRequest>(clipsDir, clipIds, clip.id, c => c.sceneId === clip.sceneId)
    const shots = coverage?.shots.slice(offset, offset + clip.shots.length) ?? []
    if (jsonOutput()) {
        log.json({
            film: id,
            clip,
            shots,
            references: clip.assets.pictures.map(p => ({...p, exists: existsSync(join(dir, p.file))})),
            render: {file: video, state: existsSync(video) ? filmClipFreshness(clip, dir, renderConfig) : 'missing'},
        })
        return
    }
    const characters = data.cast?.characters ?? []
    const nameOf = (characterId: string) => characters.find(c => c.id === characterId)?.name ?? characterId

    const scene = data.screenplay?.scenes.find(s => s.id === clip.sceneId)
    log.section(`${clip.id} · ${clip.sceneId}${scene ? ` · ${scene.setting} ${scene.location} - ${scene.time}` : ''}`)
    line('Length', `${clip.seconds}s, ${clip.frames} frames from frame ${clip.frameStart}`)
    if (clip.startsFrom) line('Goes on', `from the last frame of ${styles.name(clip.startsFrom)}`)
    if (coverage?.staging) line('Staging', coverage.staging)

    log.section(`SHOTS ${offset + 1}-${offset + clip.shots.length} OF ${coverage?.shots.length ?? '?'}`)
    clip.shots.forEach((cut, n) => {
        const shot = shots[n]
        log.info(
            `${styles.name(cut.label)} ${styles.muted(`at ${cut.at}s · ${shot?.framing ?? cut.framing}${shot?.hold ? ' · held' : ''}${shot?.continues ? ' · same take' : ''}${shot?.cutaway ? ' · cutaway' : ''}`)}`,
        )
        if (!shot) return log.info(styles.warning('   not in the coverage of the scene any more - plan the film again'))
        log.info(`   ${shot.action}`)
        if (shot.characters.length) log.info(styles.muted(`   in the picture: ${shot.characters.map(nameOf).join(', ')}`))
        for (const [person, p] of Object.entries(shot.people ?? {}))
            log.info(styles.muted(`   ${nameOf(person)}: ${[p.state, p.frame, p.motion].filter(Boolean).join(' | ')}`))
    })

    if (clip.dialogue.length) {
        log.section('DIALOGUE')
        for (const d of clip.dialogue) log.info(`${styles.name(`${d.speakerId} ${d.speaker}`)} ${styles.muted(`at ${d.at}s · ${d.kind}`)} ${d.text}`)
    }

    showReferences(dir, clip.assets.pictures)
    await showRender(
        video,
        clip.id,
        `bun film.ts ${id}`,
        () => filmClipFreshness(clip, dir, renderConfig),
        sidecar => [sidecar.contextFrames !== undefined ? `${shownOf(sidecar.contextFrames)} context frames` : ''],
    )

    log.box('Prompt', clip.prompt)
    for (const finding of checkPrompt(clip)) log.warn(`prompt: ${finding}`)
}

// What the two halves share - function declarations, so the --film branch at the top can call them before this point.

function line(label: string, value: string) {
    log.info(`${styles.label(label.padEnd(12))} ${value}`)
}

/** The planned clips of a project or film - stops when `clipId` is none of them. `planFirst`: what to plan first, and how. */
function requestedClip(dir: string, clipId: string | undefined, planFirst: string) {
    const clipsDir = clipRequestsDir(dir)
    const clipIds = existsSync(clipsDir)
        ? readdirSync(clipsDir)
              .filter(f => f.endsWith('.json'))
              .map(f => f.slice(0, -5))
              .sort()
        : []
    if (!clipIds.length) log.usageError(`${clipsDir} has no clip requests - plan the ${planFirst}`, usage)
    if (!clipId || !clipIds.includes(clipId))
        log.usageError(`${clipId ? `No clip "${clipId}"` : 'Which clip?'} - the clips are ${clipIds[0]} to ${clipIds.at(-1)}`, usage)
    return {clipsDir, clipIds}
}

/** Where the clip's shots start among the planned shots of its beat or scene: the clips of the same one before it come first. */
async function shotOffset<C extends {shots: unknown[]}>(clipsDir: string, clipIds: string[], clipId: string, sameGroup: (other: C) => boolean) {
    const earlier = await Promise.all(clipIds.filter(other => other < clipId).map(other => Bun.file(join(clipsDir, `${other}.json`)).json() as Promise<C>))
    return earlier.filter(sameGroup).reduce((sum, c) => sum + c.shots.length, 0)
}

function showReferences(dir: string, pictures: {label: string; kind: string; name: string; file: string}[]) {
    log.section('REFERENCES')
    for (const picture of pictures) {
        const there = existsSync(join(dir, picture.file))
        log.info(
            `${styles.name(picture.label.padEnd(12))} ${picture.kind.padEnd(9)} ${picture.name.padEnd(24)} ${there ? styles.muted(picture.file) : styles.warning(`${picture.file} - missing`)}`,
        )
    }
}

/** Whether the clip is rendered, from which request, and what its sidecar says. `render`: the command that renders it. */
async function showRender(
    video: string,
    clipId: string,
    render: string,
    state: () => ReturnType<typeof freshness>,
    more: (sidecar: Record<string, unknown>) => string[],
) {
    log.section('RENDER')
    if (!existsSync(video)) return line('Video', styles.muted(`not rendered - ${render} --render=videos --only=${clipId}`))
    const current = state()
    const sidecar = existsSync(`${video}.json`) ? ((await Bun.file(`${video}.json`).json()) as Record<string, unknown>) : {}
    line(
        'Video',
        `${video} ${styles.muted([sidecar.workflow, sidecar.size, sidecar.seed !== undefined ? `seed ${shownOf(sidecar.seed)}` : '', ...more(sidecar)].filter(Boolean).join(' · '))}`,
    )
    line(
        'Request',
        current === 'stale'
            ? styles.warning(`stale - made from another request than the plan has now (--render=videos --refresh=clips, or --only=${clipId} --again)`)
            : current === 'current'
              ? 'current - made from this request'
              : styles.muted('not compared (your own file, or made before fingerprints)'),
    )
}
