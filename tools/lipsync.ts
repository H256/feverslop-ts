import {parseCommand, usageOf} from '../lib/command-schema.ts'
import {lipsyncCommand} from '../lib/lipsync-command.ts'
import {cli} from '../lib/cli.ts'
// The lip-sync preview (#1016): the whole song as a close-up of a dummy singer on a plain background, to judge the lyric timing before the real previews and the final
// render. The configured video workflow renders every clip of the cut at config.lipsyncScale of its pixels (its own steps), with the vocals stem and the full
// song as a real clip gets them, and with a prompt built from the saved lyric timing the way a real one is. Nothing of the plan is needed - no story, cast, look or
// shots, and no picture: the dummy is a subject made of words. The files are previews/lipsync/<clip>.mp4 - nothing real goes stale by them.
// usage: bun run lipsync <project-id> [--only=slot-001,...] [--again] [--scale=0.125] [--dummies=1|2] [--dummy=TEXT] [--dummy2=TEXT] [--json] [--comfy=URL]
//   --json: the clips of the preview with their prompt and state, nothing rendered
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {versionStamp} from '../lib/archive.ts'
import {onlyClips} from '../lib/batch.ts'
import {lipsyncDummiesProblem, lipsyncDummyProblem, lipsyncScaleProblem, loadProjectConfig} from '../lib/config.ts'
import {songFileOf} from '../lib/inputs.ts'
import {audioPrints, lipsyncFile, lipsyncFingerprint, lipsyncRequests, recordedLipsync} from '../lib/lipsync.ts'
import {lockProject} from '../lib/lock.ts'
import {keepLogIn, log, styles} from '../lib/log.ts'
import {fingerprint} from '../lib/provenance.ts'
import {projectDir, projectExists, listProjects} from '../lib/project-setup.ts'
import type {Project} from '../lib/project.ts'
import {Renderer} from '../lib/render.ts'
import {runEvent} from '../lib/run-events.ts'
import {beginRun} from '../lib/run-record-view.ts'
import {loadSettings} from '../lib/settings.ts'
import {keepTimingsIn} from '../lib/timings.ts'
import {noProject} from '../lib/usage.ts'
cli('lipsync')

const usage = usageOf(lipsyncCommand)
const parsed = (() => {
    try {
        return parseCommand(lipsyncCommand, Bun.argv.slice(2))
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const [id] = parsed.positionals
if (!id || !projectExists(id)) log.usageError(noProject('project', id, listProjects()), usage)
const dir = projectDir(id!)
const config = await loadProjectConfig(dir)
// an option says another value for this run; it is checked as config.json is
const asked = {
    ...(parsed.text('scale') !== undefined ? {lipsyncScale: Number(parsed.text('scale'))} : {}),
    ...(parsed.text('dummies') !== undefined ? {lipsyncDummies: Number(parsed.text('dummies')) as 1 | 2} : {}),
    ...(parsed.text('dummy') !== undefined ? {lipsyncDummy: parsed.text('dummy')!} : {}),
    ...(parsed.text('dummy2') !== undefined ? {lipsyncDummy2: parsed.text('dummy2')!} : {}),
}
const wrong = [
    'lipsyncScale' in asked ? lipsyncScaleProblem(asked.lipsyncScale) : undefined,
    'lipsyncDummies' in asked ? lipsyncDummiesProblem(asked.lipsyncDummies) : undefined,
    'lipsyncDummy' in asked ? lipsyncDummyProblem('--dummy', asked.lipsyncDummy) : undefined,
    'lipsyncDummy2' in asked ? lipsyncDummyProblem('--dummy2', asked.lipsyncDummy2) : undefined,
].find(Boolean)
if (wrong) log.usageError(wrong, usage)
const used = {...config, ...asked}

const data = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Project
const clips = lipsyncRequests(data, used)
if (!clips.length)
    log.usageError(
        `${id} has no timed lyrics or no cut of the song - they come with the plan run: bun index.ts ${id} --until=story (with "alignLyrics" or singers)`,
        usage,
    )
const songFile = songFileOf(dir)
const stemFiles: Record<string, string> = {...(data.stems?.vocals ? {vocals: join(dir, data.stems.vocals)} : {}), song: songFile}
if (!existsSync(stemFiles.vocals ?? '')) log.usageError(`${id} has no vocals stem - it comes with the plan run: bun index.ts ${id} --until=story`, usage)
const prints = audioPrints(dir, data, songFile)
const stateOf = (clip: (typeof clips)[number]) => {
    const made = recordedLipsync(join(dir, lipsyncFile(clip.id)))
    return !made ? 'missing' : made.fingerprint === fingerprint(...lipsyncFingerprint(clip, used, prints)) ? 'current' : 'outdated'
}

if (parsed.flag('json')) {
    console.log(JSON.stringify({clips: clips.map(c => ({...c, file: lipsyncFile(c.id), state: stateOf(c)}))}, null, 2))
    process.exit(0)
}

const only = new Set((parsed.text('only') ?? '').split(',').filter(Boolean))
const selected = onlyClips(clips, only)
if (!selected.length) log.usageError(`no such clips: ${[...only].join(', ')} - the clips are ${clips.map(c => c.id).join(', ')}`, usage)
lockProject(dir, id!)
keepTimingsIn(dir)
keepLogIn(join(dir, 'logs', `${versionStamp()}.log`))
beginRun(dir, 'tools/lipsync.ts')

const settings = await loadSettings({projectModel: config.llm.model, ...(parsed.text('comfy') ? {comfy: parsed.text('comfy')!} : {})})
using renderer = new Renderer(id!, dir, used, settings.comfy)
log.section('LIP-SYNC PREVIEW')
log.step(
    'Config',
    styles.muted(
        `${used.lipsyncDummies} dummy${used.lipsyncDummies > 1 ? 's' : ''}, ${used.lipsyncScale} of the pixels of ${used.videoResolution} (${used.videoWorkflow}), the workflow's own steps`,
    ),
)
log.step('Clips', `${selected.length}${only.size ? styles.muted(` of ${clips.length} (--only)`) : ''}`)
await renderer.serversFirst()
const todo = selected.filter(c => parsed.flag('again') || stateOf(c) !== 'current')
runEvent({type: 'jobs', kind: 'clip', ids: todo.map(c => `lipsync-${c.id}`)})
await Promise.all(
    selected.map(async clip => {
        try {
            await renderer.renderLipsync(clip, stemFiles, prints, {scale: used.lipsyncScale, again: parsed.flag('again')})
        } finally {
            renderer.settle(join(dir, lipsyncFile(clip.id)))
        }
    }),
)
log.step('Done', styles.muted('previews/lipsync/ - the player is on the Timing page'))
