import {FPS, frameAt, round} from "../frames.ts";
import {characterOf, speechSeconds} from "./screenplay.ts";
import {collapseEmptyScene, softProblems} from "./shot-checks.ts";
import type {FilmCast, Scene, SceneCoverage, Screenplay, Shot} from "./types.ts";

// The longest a clip can be: the video model renders 5 + 17·k frames and every clip is rounded up to such a length, so
// it is set a little under 10 s - the same limit as the music-video pipeline's MAX_CLIP_SEC
export const MAX_CLIP_SEC = 10 - 17 / FPS
const MAX_SHOT_SEC = 8
const MIN_SHOT_SEC = 2
// the model starts a line about a second into the shot, and the end of a line needs a moment before the cut (measured on rendered clips)
const LEAD_IN_SEC = 1.2

type RawShot = { framing?: unknown, camera?: unknown, characters?: unknown, action?: unknown, lines?: unknown, seconds?: unknown, continues?: unknown }
export type RawCoverage = { soundscape?: unknown, staging?: unknown, shots?: RawShot[] }

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const dialogueOf = (scene: Scene) => scene.elements.filter(element => element.type === 'dialogue')

/** Seconds a shot needs for its lines - speaking time of every line plus a beat before the reaction. */
export const speakingSeconds = (scene: Scene, lines: number[]) => {
    const dialogue = dialogueOf(scene)
    return lines.reduce((sum, n) => sum + speechSeconds(dialogue[n]!.text), 0) + (lines.length ? LEAD_IN_SEC : 0)
}

/** What the model can fix by being asked again: a dialogue line lost or twice, an unknown name. */
export class CoverageProblem extends Error {
    constructor(readonly problems: string[]) {
        super(problems.join('; '))
    }
}

/**
 * Checks what the LLM planned for a scene and turns it into a SceneCoverage. Everything else is normalized: a speaker on
 * screen is always in the shot's characters, and a shot is never shorter than its lines.
 */
/**
 * strict: what lib/film/shot-checks.ts finds (people in a scene that names none, speech without a line, too many shots) is a problem the planner is asked
 * to fix; not strict, it is only noted - a rule of thumb must never stop a film.
 */
export function toCoverage(raw: RawCoverage, scene: Scene, cast: FilmCast, strict = true): { coverage: SceneCoverage, notes: string[] } {
    if (!Array.isArray(raw?.shots) || !raw.shots.length) throw new CoverageProblem(['there are no shots'])
    const dialogue = dialogueOf(scene)
    const problems: string[] = []
    const used: number[] = []

    const shots = raw.shots.map((shot, i): Shot => {
        const lines = (Array.isArray(shot.lines) ? shot.lines : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= dialogue.length).map(n => n - 1)
        used.push(...lines)
        const names = Array.isArray(shot.characters) ? shot.characters.map(text).filter(Boolean) : []
        const ids = names.flatMap(name => {
            const found = characterOf(cast, name)
            if (!found) problems.push(`shot ${i + 1}: "${name}" is not one of the characters`)
            return found ? [found.id] : []
        })
        // whoever speaks on screen is in the picture
        for (const n of lines) {
            const line = dialogue[n]!
            const speaker = line.type === 'dialogue' && line.kind === 'spoken' ? characterOf(cast, line.speaker) : undefined
            if (speaker && !speaker.voiceOnly && !ids.includes(speaker.id)) ids.push(speaker.id)
        }
        const asked = Number(shot.seconds)
        const planned = Number.isFinite(asked) ? Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, asked)) : 4
        return {
            framing: text(shot.framing) || 'medium shot',
            camera: text(shot.camera) || 'the camera drifts slowly closer',
            characters: [...new Set(ids)],
            action: text(shot.action),
            lines,
            seconds: round(Math.max(planned, speakingSeconds(scene, lines))),
            ...(shot.continues === true && i > 0 ? {continues: true} : {}),
        }
    })

    const expected = dialogue.map((_, n) => n)
    if (used.join() !== expected.join()) {
        const missing = expected.filter(n => !used.includes(n)).map(n => `D${n + 1}`)
        const twice = [...new Set(used.filter((n, i) => used.indexOf(n) !== i))].map(n => `D${n + 1}`)
        if (missing.length) problems.push(`dialogue line(s) ${missing.join(', ')} are in no shot`)
        if (twice.length) problems.push(`dialogue line(s) ${twice.join(', ')} are in more than one shot`)
        if (!missing.length && !twice.length) problems.push('the dialogue lines are not in the order of the script')
    }
    if (shots.some(s => !s.action)) problems.push('every shot needs an action')
    if (problems.length) throw new CoverageProblem(problems)
    // a scene that is only a place is one shot, without people
    const {shots: unique, notes} = collapseEmptyScene(shots, scene, cast)
    const soft = softProblems(unique, scene, cast)
    if (soft.length && strict) throw new CoverageProblem(soft)
    notes.push(...soft.map(p => `kept anyway: ${p}`))
    return {coverage: {sceneId: scene.id, soundscape: text(raw.soundscape), staging: text(raw.staging), shots: unique}, notes}
}

// A clip of the film: consecutive shots of one scene that fit into MAX_CLIP_SEC together
export type FilmClip = {
    id: string,                     // clip-001, ...
    index: number,
    sceneId: string,
    opensScene: boolean,
    shots: Shot[],
    seconds: number,
    frameStart: number,             // on the film's 24 fps frame grid
    frames: number,                 // frames the clip contributes to the final film
    startsFrom?: string,            // id of the clip it goes on from: it starts on that clip's last frame
}

/**
 * Packs the shots of every scene into clips, in order: a clip never spans two scenes (the place changes), a shot is never
 * split (so no line of dialogue is cut in two), and a clip holds as many shots as fit into MAX_CLIP_SEC. A shot that
 * goes on in the same take as the one before it starts a continuing clip when it opens one (config.continuity).
 */
export function packClips(screenplay: Screenplay, coverage: SceneCoverage[], continuity: 'auto' | 'scene' | 'never'): FilmClip[] {
    const clips: FilmClip[] = []
    let frameStart = 0
    for (const scene of screenplay.scenes) {
        // the time a shot needs for its lines is worked out again here: a plan made with a shorter estimate gets the new one
        const shots = coverage.find(c => c.sceneId === scene.id)?.shots.map(s => ({...s, seconds: round(Math.max(s.seconds, speakingSeconds(scene, s.lines)))}))
        if (!shots) throw new Error(`no shots for scene ${scene.id} - run again, or --redo=coverage`)
        let current: Shot[] = []
        const flush = () => {
            if (!current.length) return
            const seconds = round(current.reduce((sum, s) => sum + s.seconds, 0))
            const frames = frameAt(seconds)
            const index = clips.length + 1
            const previous = clips.at(-1)
            clips.push({
                id: `clip-${String(index).padStart(3, '0')}`, index, sceneId: scene.id, opensScene: !clips.some(c => c.sceneId === scene.id),
                shots: current, seconds, frameStart, frames,
                ...((continuity === 'scene' || (continuity === 'auto' && current[0]!.continues)) && previous?.sceneId === scene.id ? {startsFrom: previous.id} : {}),
            })
            frameStart += frames
            current = []
        }
        for (const shot of shots) {
            if (current.length && current.reduce((sum, s) => sum + s.seconds, 0) + shot.seconds > MAX_CLIP_SEC) flush()
            current.push(shot)
        }
        flush()
    }
    return clips
}
