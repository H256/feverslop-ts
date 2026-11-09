import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {AskOptions} from '../llm.ts'
import {boundaryFrameAsset} from '../compose.ts'
import type {FilmClipRequest} from './compose.ts'

// A cut within a scene goes to another camera position, and every clip is drawn by itself: the people can come out in another
// posture, other clothes or with something else in the hand than in the clip before - the staging asks for the same, but
// only says it. This compares the last frame of a clip with the first frame of the next one in the same scene, with a model
// that reads pictures (bun run film:check-joins). It only says what it finds: rendering a clip again stays explicit.

export type Join = {from: string; to: string; sceneId: string}
export type JoinVerdict = {fits: boolean; differences: string[]}
export type JoinRecord = JoinVerdict & {fingerprint: string}

/** Another wording of the question asks every join again. */
const QUESTION_VERSION = 2

/**
 * The cuts of a film: two clips after each other in the same scene where the second does not go on from the first. A clip that
 * goes on starts on the last frame of the one before - there is nothing to compare.
 */
export function cutsOf(requests: Pick<FilmClipRequest, 'id' | 'sceneId' | 'startsFrom'>[]): Join[] {
    return requests.slice(1).flatMap((clip, i) => {
        const before = requests[i]!
        return clip.sceneId === before.sceneId && clip.startsFrom !== before.id ? [{from: before.id, to: clip.id, sceneId: clip.sceneId}] : []
    })
}

/** The two pictures of a join: the last frame the film uses of the clip before, the first of the next one. */
export const joinFrames = (join_: Join) => [boundaryFrameAsset(join_.from, 'lf'), boundaryFrameAsset(join_.to, 'ff')]

type Pictured = Pick<FilmClipRequest, 'assets'>

/**
 * The looks the plan changes at a cut (lib/film/pictures.ts statePictureId: <character>--<state>): a character drawn from another
 * picture in the next clip, with what that picture shows - a change the plan wants is no fault.
 */
export function plannedChanges(before: Pictured, after: Pictured): string[] {
    const looks = (clip: Pictured) => new Map(clip.assets.pictures.filter(p => p.kind === 'character').map(p => [p.id.split('--')[0]!, p]))
    const was = looks(before)
    return [...looks(after)].flatMap(([character, picture]) => {
        const earlier = was.get(character)
        return earlier && earlier.id !== picture.id ? [`${picture.name}: from here on ${picture.description}`] : []
    })
}

/** What a join is made from: its two frames, the staging and the planned changes - the same answer for the same pictures. */
export function joinFingerprint(dir: string, join_: Join, staging: string, changes: string[] = []): string | undefined {
    const files = joinFrames(join_).map(file => join(dir, file))
    if (!files.every(existsSync)) return undefined
    return Bun.hash([QUESTION_VERSION, staging, ...changes, ...files.map(file => Bun.hash(readFileSync(file)).toString(16))].join('.')).toString(16)
}

export function joinPrompt(images: string[], staging: string, changes: string[] = []): AskOptions {
    return {
        input: `The two attached images are the last frame of one shot of a film and the first frame of the next shot, in this order. Both shots are in the same scene, one right after the other: the camera cut to another position, and the scene goes on. What everybody does and where they are is to be the same across the cut, seen from the new angle.
The scene as planned: ${staging || '(no staging written)'}
${changes.length ? `Planned at this cut - no difference: ${changes.join(' ')}\n` : ''}
Compare the people and what is fixed in the scene. Count as a difference: a person in the first image who is missing in the second although the second frame would show where they were, or the other way round; another posture (standing against sitting or lying); someone at another place of the room than a moment before (beside someone in the first, at the far end in the second); other clothes, another state of the clothes or an injury that came or went; something held in one image and not in the other; another time of day or another light. The camera angle, the framing, how big someone is in the picture and a small movement between the two frames are no difference.
Only what is clearly seen in both images counts: a person who is small, blurred, seen from behind or cut off by the frame in one of them is no evidence about their face, hair, clothes or what they wear - say nothing about those then.

Answer only with JSON: {"fits": true or false, "differences": ["one short sentence per difference, naming the person or the thing"]} - "differences" is empty when it fits.`,
        images,
        instructions: 'You are a script supervisor who checks the continuity of a film across a cut from two frames. Answer only with JSON.',
        reasoning: 'low',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['fits', 'differences'],
            properties: {fits: {type: 'boolean'}, differences: {type: 'array', items: {type: 'string'}}},
        },
    }
}

/** A verdict as the model gave it, made plain: no differences is a fit, whatever "fits" says. */
export function readVerdict(raw: unknown): JoinVerdict {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const differences = Array.isArray(o.differences) ? o.differences.map(d => String(d).trim()).filter(Boolean) : []
    return {fits: differences.length === 0, differences}
}
