import {MAX_REFERENCE_IMAGES} from "../../comfy/helpers.ts";
import {FPS, frameAt, round} from "../frames.ts";
import {mentions} from "./names.ts";
import {characterOf, speechSeconds} from "./screenplay.ts";
import {collapseEmptyScene, softProblems} from "./shot-checks.ts";
import type {Facing, FilmCast, Scene, SceneCoverage, Screenplay, Shot} from "./types.ts";

const FACINGS: readonly string[] = ['left', 'right', 'camera', 'away']

// The longest a clip can be: the video model renders 5 + 17·k frames and every clip is rounded up to such a length, so
// it is set a little under 10 s - the same limit as the music-video pipeline's MAX_CLIP_SEC
export const MAX_CLIP_SEC = 10 - 17 / FPS
const MAX_SHOT_SEC = 8
const MIN_SHOT_SEC = 2
// a shot with more speech than this is cut into shots with a part of the line each - the video model is limited to ~10 s a clip
const MAX_SPEECH_SHOT_SEC = MAX_CLIP_SEC
const SPLIT_TARGET_SEC = 8.3
// the model starts a line about a second into the shot, and the end of a line needs a moment before the cut (measured on rendered clips)
export const LEAD_IN_SEC = 1.2

type RawShot = { framing?: unknown, camera?: unknown, characters?: unknown, action?: unknown, lines?: unknown, deliveries?: unknown, states?: unknown, view?: unknown, placeView?: unknown, hold?: unknown, cutaway?: unknown, people?: unknown, seconds?: unknown, continues?: unknown }
export type RawCoverage = { soundscape?: unknown, staging?: unknown, ends?: unknown, people?: unknown, voices?: unknown, fast?: unknown, shots?: RawShot[] }

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const dialogueOf = (scene: Scene) => scene.elements.filter(element => element.type === 'dialogue')

/** Seconds a shot needs for its lines - speaking time of every line plus a beat before the reaction. */
export const speakingSeconds = (scene: Scene, lines: number[]) => {
    const dialogue = dialogueOf(scene)
    return lines.reduce((sum, n) => sum + speechSeconds(dialogue[n]!.text), 0) + (lines.length ? LEAD_IN_SEC : 0)
}

const segments = (value: string, granularity: 'sentence' | 'word') =>
    [...new Intl.Segmenter(undefined, {granularity}).segment(value)].map(s => s.segment)

/** The text cut into pieces of at most `maxSec` speaking time: at sentence ends, a sentence that is too long at word breaks. Joined, the pieces are the text. */
function speechParts(value: string, maxSec: number): string[] {
    const pieces = segments(value, 'sentence').flatMap(sentence => speechSeconds(sentence) <= maxSec ? [sentence] : (() => {
        const words = segments(sentence, 'word')
        const out: string[] = []
        for (const word of words) out.length && speechSeconds(out.at(-1)! + word) <= maxSec ? out[out.length - 1] += word : out.push(word)
        return out
    })())
    const total = speechSeconds(value)
    const share = Math.min(maxSec, total / Math.ceil(total / maxSec) * 1.25)
    const parts: string[] = []
    for (const piece of pieces) parts.length && speechSeconds(parts.at(-1)! + piece) <= share ? parts[parts.length - 1] += piece : parts.push(piece)
    return parts.map(p => p.trim()).filter(Boolean)
}

/**
 * A shot whose lines take longer than a clip is cut into shots that each speak a part of them - sentence by sentence, the
 * words never change. The shots after the first go on in the same take, from the last frame of the one before.
 */
export function splitLongShot(scene: Scene, shot: Shot): Shot[] {
    if (shot.seconds <= MAX_SPEECH_SHOT_SEC || !shot.lines.length) return [shot]
    const dialogue = dialogueOf(scene)
    const units = shot.lines.flatMap(n => speechParts(dialogue[n]!.text, SPLIT_TARGET_SEC - LEAD_IN_SEC).map(text => ({line: n, text})))
    const groups: { line: number, text: string }[][] = []
    for (const unit of units) {
        const last = groups.at(-1)
        const sec = (g: { text: string }[]) => g.reduce((sum, u) => sum + speechSeconds(u.text), 0) + LEAD_IN_SEC
        last && sec([...last, unit]) <= SPLIT_TARGET_SEC ? last.push(unit) : groups.push([unit])
    }
    if (groups.length < 2) return [shot]
    return groups.map((group, i) => {
        const lines = [...new Set(group.map(u => u.line))]
        const texts = lines.map(n => group.filter(u => u.line === n).map(u => u.text).join(' '))
        const whole = (n: number, text: string) => text === dialogue[n]!.text ? undefined : text
        return {
            ...shot,
            lines,
            ...(lines.some((n, k) => whole(n, texts[k]!)) ? {texts} : {}),
            // the parts after the first go on speaking in the same take: the action is not told again (the model would do it again)
            action: i ? 'The shot goes on without a cut: nothing starts over and nobody repeats what they did - the speaker goes on speaking in the same place and pose, the others stay as they are.' : shot.action,
            // ... and nobody is told again where they stand or what they do - but how each is in the picture stays (a listener who is only a shoulder at the edge of
            // it must not be given a place in the middle: the video model then draws a whole second person there, or falls back to the character's picture)
            ...(i && shot.people ? {people: Object.fromEntries(Object.entries(shot.people).map(([id, p]) => [id, {frame: p.frame, facing: p.facing, foreground: p.foreground}]))} : {}),
            seconds: round(group.reduce((sum, u) => sum + speechSeconds(u.text), 0) + LEAD_IN_SEC),
            ...(i ? {continues: true} : {}),
        }
    })
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
export function toCoverage(raw: RawCoverage, scene: Scene, cast: FilmCast, strict = true, introduced?: ReadonlySet<string>, sceneNumber?: number): { coverage: SceneCoverage, notes: string[] } {
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
        // whoever speaks on screen is in the picture - unless the shot is a cutaway: hands, an object or a place while the line is heard
        for (const n of shot.cutaway === true ? [] : lines) {
            const line = dialogue[n]!
            const speaker = line.type === 'dialogue' && line.kind === 'spoken' ? characterOf(cast, line.speaker) : undefined
            if (speaker && !speaker.voiceOnly && !ids.includes(speaker.id)) ids.push(speaker.id)
        }
        // the looks the shot has: character name -> look name, kept for characters who are in the shot
        const states: Record<string, string> = {}
        if (shot.states && typeof shot.states === 'object' && !Array.isArray(shot.states)) {
            for (const [who, which] of Object.entries(shot.states as Record<string, unknown>)) {
                const character = characterOf(cast, who)
                const wanted = text(which).toLowerCase()
                const state = character?.states?.find(s => s.id === wanted || s.name.toLowerCase() === wanted)
                if (!wanted || wanted === 'normal') continue
                if (!character || !state) problems.push(`shot ${i + 1}: "${who}" has no look "${text(which)}"`)
                // a look the script has not given yet (it begins in a later scene) is not used: the character has the normal look
                else if (ids.includes(character.id) && !(sceneNumber !== undefined && state.from && sceneNumber < state.from)) states[character.id] = state.id
            }
        }
        // per person in the shot: where they are and what they hold at its start, and how they are in the picture
        const people: NonNullable<Shot['people']> = {}
        if (shot.people && typeof shot.people === 'object' && !Array.isArray(shot.people)) {
            for (const [who, entry] of Object.entries(shot.people as Record<string, unknown>)) {
                const character = characterOf(cast, who)
                const e = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
                if (character && ids.includes(character.id) && (text(e.state) || text(e.frame) || text(e.motion) || FACINGS.includes(text(e.facing) as Facing))) people[character.id] = {...(text(e.state) ? {state: text(e.state)} : {}), ...(text(e.frame) ? {frame: text(e.frame)} : {}), ...(text(e.motion) ? {motion: text(e.motion)} : {}), ...(FACINGS.includes(text(e.facing) as Facing) ? {facing: text(e.facing) as Facing} : {}), ...(e.foreground === true ? {foreground: true} : {})}
            }
        }
        const said = Array.isArray(shot.deliveries) ? shot.deliveries.map(text) : []
        const deliveries = lines.map((_, k) => said[k] ?? '')
        const asked = Number(shot.seconds)
        const planned = Number.isFinite(asked) ? Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, asked)) : 4
        return {
            framing: text(shot.framing) || 'medium shot',
            camera: text(shot.camera) || 'the camera drifts slowly closer',
            characters: [...new Set(ids)],
            action: text(shot.action),
            lines,
            ...(deliveries.some(Boolean) ? {deliveries} : {}),
            ...(Object.keys(states).length ? {states} : {}),
            ...(text(shot.view) ? {view: text(shot.view)} : {}),
            ...(shot.hold === true ? {hold: true} : {}),
            ...(shot.cutaway === true ? {cutaway: true} : {}),
            ...(Number.isInteger(Number(shot.placeView)) && Number(shot.placeView) >= 1 && Number(shot.placeView) <= 5 ? {placeView: Number(shot.placeView)} : {}),
            ...(Object.keys(people).length ? {people} : {}),
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
    const {shots: unique, notes} = collapseEmptyScene(shots, scene, raw.people === false ? false : raw.people === true ? true : undefined)
    const soft = softProblems(unique, scene, raw.fast === true)
    // a character the script has not brought in yet (named neither in this scene nor in one before) is not in the picture: asked again once, then left out
    if (introduced) {
        unique.forEach((shot, i) => {
            const early = shot.characters.filter(id => !introduced.has(id))
            if (!early.length) return
            const who = early.map(id => cast.characters.find(c => c.id === id)?.name ?? id).join(', ')
            if (strict) {
                soft.push(`shot ${i + 1}: ${who} ${early.length > 1 ? 'are' : 'is'} not in the script yet - it names them in a later scene; the shot shows the place or whoever the script has there, without them (the look brief says where everyone stands in the film, not who is in this scene)`)
            } else {
                shot.characters = shot.characters.filter(id => introduced.has(id))
                for (const id of early) delete shot.people?.[id]
                notes.push(`shot ${i + 1}: ${who} left out - the script does not bring them in yet`)
            }
        })
    }
    // someone who talks to a person in the picture looks at them, not into the lens - the shot of their face is taken from the listener's side
    unique.forEach((shot, i) => {
        if (shot.characters.length < 2) return
        const speakers = new Set(shot.lines.flatMap(n => {
            const line = dialogue[n]
            const who = line?.type === 'dialogue' && line.kind === 'spoken' ? characterOf(cast, line.speaker) : undefined
            return who ? [who.id] : []
        }))
        for (const id of speakers) {
            if (shot.people?.[id]?.facing !== 'camera') continue
            const others = shot.characters.filter(c => c !== id).map(c => cast.characters.find(x => x.id === c)?.name ?? c)
            soft.push(`shot ${i + 1}: ${cast.characters.find(c => c.id === id)?.name ?? id} talks to ${others.join(' and ')} but looks into the lens - they look at ${others.join(' and ')} ("facing": "left" or "right"), and the shot of their face is taken from ${others.join(' and ')}'s side, the listener a shoulder in the foreground or just outside the picture`)
        }
    })
    // the action names someone who is not in the shot: the video model draws a stranger for a name without a picture
    unique.forEach((shot, i) => {
        const written = [shot.action, shot.view ?? '', ...Object.values(shot.people ?? {}).flatMap(p => [p.state ?? '', p.frame ?? ''])].join(' ')
        const strangers = cast.characters.filter(c => !c.voiceOnly && !shot.characters.includes(c.id) && mentions(written, c)).map(c => c.name)
        if (strangers.length) soft.push(`shot ${i + 1}: the shot's text names ${strangers.join(', ')}, who ${strangers.length > 1 ? 'are' : 'is'} not in the shot's characters - leave them out of the action, or put them in the shot`)
    })
    if (soft.length && strict) throw new CoverageProblem(soft)
    notes.push(...soft.map(p => `kept anyway: ${p}`))
    // where everyone is when the scene ends - the next scene starts from it
    const ends: Record<string, string> = {}
    if (raw.ends && typeof raw.ends === 'object' && !Array.isArray(raw.ends)) {
        for (const [who, where] of Object.entries(raw.ends as Record<string, unknown>)) {
            const character = characterOf(cast, who)
            if (character && text(where) && (!introduced || introduced.has(character.id))) ends[character.id] = text(where)
        }
    }
    return {coverage: {sceneId: scene.id, soundscape: text(raw.soundscape), staging: text(raw.staging), ...(Object.keys(ends).length ? {ends} : {}), ...(typeof raw.people === 'boolean' ? {people: raw.people} : {}), ...(typeof raw.voices === 'boolean' ? {voices: raw.voices} : {}), ...(raw.fast === true ? {fast: true} : {}), shots: unique}, notes}
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
 * Does a clip whose first shot is `first` go on from the clip before (whose last shot is `last`) without a cut? With
 * continuity "auto" only where the plan says the take goes on; with "scene" also where the first shot is the same picture -
 * the same framing from the same place. A shot planned as another setup is a cut, and a clip that starts on the frames of the
 * one before cannot make it: told to go on into another setup the video model rebuilt the place in the middle of the clip
 * (people swapping sides, a person twice), and a hard cut asked for right after the context frames did not come.
 */
export function goesOnWithoutCut(first: Shot, last: Shot | undefined, continuity: 'auto' | 'scene' | 'never'): boolean {
    if (continuity === 'never' || !last) return false
    if (first.continues) return true
    return continuity === 'scene' && first.framing === last.framing && (first.view ?? '') === (last.view ?? '')
}

/**
 * Packs the shots of every scene into clips, in order: a clip never spans two scenes (the place changes), a shot is never
 * split (so no line of dialogue is cut in two), and a clip holds as many shots as fit into MAX_CLIP_SEC. A shot that
 * goes on in the same take as the one before it starts a continuing clip when it opens one (config.continuity).
 */
/** The people a clip can show: the video model takes MAX_REFERENCE_IMAGES pictures, one of them the place. */
export const MAX_PEOPLE_PER_CLIP = MAX_REFERENCE_IMAGES - 1

export function packClips(screenplay: Screenplay, coverage: SceneCoverage[], continuity: 'auto' | 'scene' | 'never'): FilmClip[] {
    const clips: FilmClip[] = []
    let frameStart = 0
    for (const scene of screenplay.scenes) {
        // the time a shot needs for its lines is worked out again here: a plan made with a shorter estimate gets the new one
        const shots = coverage.find(c => c.sceneId === scene.id)?.shots.map(s => ({...s, seconds: round(Math.max(s.seconds, speakingSeconds(scene, s.lines)))})).flatMap(s => splitLongShot(scene, s))
        if (!shots) throw new Error(`no shots for scene ${scene.id} - run again, or --redo=coverage`)
        // a single shot that still does not fit a clip (no line to split it at, or one unit longer than a clip) is a plan
        // that cannot be rendered as it is - said here, not found as a failed or cut-off render
        for (const [k, shot] of shots.entries()) {
            if (shot.seconds > MAX_CLIP_SEC) throw new Error(`scene ${scene.id}, shot ${k + 1}: ${shot.seconds}s is longer than a clip can be (${round(MAX_CLIP_SEC)}s) and cannot be split - shorten it or divide it into shots (--redo=coverage --scenes=${scene.id})`)
        }
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
                ...(previous?.sceneId === scene.id && goesOnWithoutCut(current[0]!, previous.shots.at(-1), continuity) ? {startsFrom: previous.id} : {}),
            })
            frameStart += frames
            current = []
        }
        for (const shot of shots) {
            // a clip also ends where the people of its shots would no longer all get a picture of their own
            const people = new Set([...current, shot].flatMap(s => s.characters))
            if (current.length && (current.reduce((sum, s) => sum + s.seconds, 0) + shot.seconds > MAX_CLIP_SEC || people.size > MAX_PEOPLE_PER_CLIP)) flush()
            current.push(shot)
        }
        flush()
    }
    return clips
}
