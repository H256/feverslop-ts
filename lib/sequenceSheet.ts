// The reference-sheet feature: instead of one flat, static hero image as a character's or location's only visual
// anchor for the whole song, generate a short silent turnaround video from that hero image (see
// comfy/workflows/h3-sequence-to-sheet.ts), sample a few of its hard-cut "beats" as frames, and composite them
// into one multi-angle reference sheet - the file every clip actually references (see lib/render.ts
// renderSequenceSheet). Ported from the predecessor project's fever-slop sequence-to-sheet pipeline, rebuilt on
// ffmpeg instead of OpenCV/Pillow to stay within this project's stack.
import {mkdirSync, renameSync} from "node:fs";
import {dirname} from "node:path";
import {FPS} from "./frames.ts";
import {captureProcess, SHORT_PROCESS_TIMEOUT_MS} from "./process.ts";

export const SEQUENCE_FRAMES = 124   // ~5.17s @ 24fps - matches the predecessor project's default
const SHOT_SECONDS = 0.75            // spacing between beats, clamped to fit the render's duration

// the expression of the last beat is picked at random from these - each with its own facial description, so the
// prompt never says one expression while describing another
export const EXPRESSIONS: Record<string, string> = {
    frightened: 'eyes wide, brows raised and drawn together, mouth slightly open',
    neutral: 'eyes relaxed, brows level, mouth closed',
    joyful: 'eyes bright and crinkled at the corners, cheeks lifted, a broad smile',
    angry: 'brows lowered and drawn together, eyes narrowed, jaw clenched, lips pressed tight',
    surprised: 'eyes wide, brows raised high, mouth open in a small round shape',
    sad: 'inner brows raised, eyes lowered and glistening, corners of the mouth turned down',
    disgusted: 'nose wrinkled, upper lip raised, brows drawn down, eyes narrowed',
    confused: 'one brow raised and the other lowered, head tilted slightly, lips pursed to one side',
    excited: 'eyes wide and bright, brows raised, mouth open in an eager grin',
    contemplative: 'eyes gazing off to the side, brows slightly furrowed, lips closed and relaxed',
}

function formatTimestamp(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

function beatTimestamps(totalShots: number, frames: number): number[] {
    const duration = frames / FPS
    const step = Math.max(0.25, Math.min(SHOT_SECONDS, duration / totalShots))
    return Array.from({length: totalShots}, (_, i) => i * step)
}

/**
 * Six locked-off hard-cut views of one character from its hero image: full-body front, face close-up, left
 * profile, right profile, rear, and a medium close-up with one random expression change on the last beat (every
 * other beat holds a neutral expression, so the character's identity/build/wardrobe stay the read - only the
 * final beat exists to give the reference sheet one non-neutral expression to draw on).
 */
export function characterSequencePrompt(description: string, frames = SEQUENCE_FRAMES): { prompt: string, beatTimes: number[] } {
    const beatTimes = beatTimestamps(6, frames)
    const prompt = `Six distinct locked-off views joined by hard cuts. ${characterViews(description, beatTimes, 1)} ${SHEET_BACKDROP} Clothing, hair, colours, proportions and every visible detail remain identical across every shot.`
    return {prompt, beatTimes}
}

/**
 * Another look of a character (wounded, soaked, disguised) from the anchor of its normal picture: the video starts on that
 * anchor, holds it for one shot, and from the hard cut after it shows the six views of the character sheet in the new look -
 * everything else, the clothing too, comes from the anchor and the change from the prompt: the views name the person of the
 * first frame, not a description, whose words would redraw the clothes (a "bodice" lost the sleeves and the skirt of the
 * picture). The first beat is the lead-in: its frame is not part of the sheet (lookSheetFrames).
 */
export function characterLookSequencePrompt(change: string, frames = LOOK_SEQUENCE_FRAMES): { prompt: string, beatTimes: number[] } {
    const beatTimes = beatTimestamps(7, frames)
    const person = 'the same person as in the first frame, in exactly the same clothing - every garment, sleeve, layer and length as there - with the change'
    const prompt = `Seven distinct locked-off shots joined by hard cuts. [Shot 1] The figure exactly as in the first frame, standing still, nothing about it changes in this shot. From the cut at ${formatTimestamp(beatTimes[1]!)} on, the same person with the same face, build, hair and clothing is changed, and only this is changed: ${change} ${characterViews(person, beatTimes.slice(1), 2)} ${SHEET_BACKDROP} The change stays in every shot after the first; the clothing is the clothing of the first frame, and hair, colours, proportions and every other visible detail remain identical across these shots.`
    return {prompt, beatTimes}
}

// a look's sheet has one shot more (the lead-in): 5 + 17·8 frames keep every shot at the 0.75 s of a normal sheet - with
// SEQUENCE_FRAMES the seven shots were shorter and the model's cuts slipped (a second rear view instead of the right profile)
export const LOOK_SEQUENCE_FRAMES = 141

/** The frames of a look's sheet video that make its sheet: every beat but the lead-in. */
export const lookSheetFrames = (beatTimes: number[], totalFrames: number) => selectFrameIndices(beatTimes, totalFrames).slice(1)

const SHEET_BACKDROP = 'Plain seamless neutral grey studio backdrop, even neutral lighting from every side, no props and no cast shadows.'

/**
 * The six views of a character sheet as shots `first` to `first + 5`, at `times` - the first one opens the video (shot 1)
 * or comes after a cut. The last view has one expression drawn at random.
 */
function characterViews(description: string, times: number[], first: number): string {
    const names = Object.keys(EXPRESSIONS)
    const expression = names[Math.floor(Math.random() * names.length)]!
    const cut = (view: number) => `[Shot ${first + view}] At ${formatTimestamp(times[view]!)}, the shot cuts to`
    const opening = first === 1 ? `[Shot 1] a full-body shot frames ${description}` : `${cut(0)} a full-body shot that frames ${description}`
    return `${opening}, the entire figure visible from head to toe, facing the camera, generous empty margin on every side. The figure stands still in a neutral upright pose with arms relaxed at the sides and does not move, walk, gesture or turn at any point, and holds a neutral expression until the final shot. ${cut(1)} a tight close-up of the face, framed from the top of the hair to the chin, still facing the camera, the mouth closed and a still neutral expression. ${cut(2)} a left side profile of the full figure, the whole body visible from head to toe with the same framing margin, the head turned to show the left profile, the mouth closed and a still neutral expression. ${cut(3)} a right side profile of the full figure, the whole body visible from head to toe with the same framing margin, the head turned to show the right profile, the mouth closed and a still neutral expression. ${cut(4)} a rear view of the full figure, the back of the body visible from head to toe with the same framing margin, the mouth closed and a still neutral expression. ${cut(5)} a medium close-up of the face and shoulders, still facing the camera, the expression now ${expression}: ${EXPRESSIONS[expression]}. Only the expression changes; the figure does not flinch, recoil, turn away or move.`
}

/**
 * The five views of a location sheet, in the order of the sheet's frames (assets/sequence/locations/<id>/frames/frame_0N.png) -
 * what locationSequencePrompt asks the video for (without designed views). What the shot planning chooses from.
 */
export const LOCATION_VIEWS = [
    'a level, static front view of the location - the hero view',
    'a locked-off position at the right side of the location, looking at it from the right',
    'a locked-off position behind the location, looking back across it from the rear',
    'a locked-off position at the left side of the location, looking at it from the left',
    'a wide establishing view showing the whole location from a distance',
]

/**
 * Five locked-off tripod views of one location from its hero image: front, right side, rear, left side, wide establishing.
 * With `views` (the four views after the first, each a camera position and what is seen from it - designed for the place and its
 * story, see lib/film/prompts.ts locationViewsPrompt) the cuts go to those instead: the generic "behind the location" is a turn
 * around the same spot, and the video model has no idea what the other side of a place holds.
 */
export function locationSequencePrompt(description: string, frames = SEQUENCE_FRAMES, views?: string[]): { prompt: string, beatTimes: number[] } {
    const beatTimes = beatTimestamps(5, frames)
    if (views && views.length >= 4) {
        const cut = (i: number) => `At ${formatTimestamp(beatTimes[i]!)}, the shot cuts to a new locked-off camera position: ${views[i - 1]!.replace(/[.\s]+$/, '')}.`
        const designed = `Five distinct locked-off tripod views of the same empty location joined by hard cuts, with no camera movement inside any shot: ${description}. [Shot 1] A level, static front view of the location, matching the first frame. [Shot 2] ${cut(1)} [Shot 3] ${cut(2)} [Shot 4] ${cut(3)} [Shot 5] ${cut(4)} The camera never pans, tilts, dollies, orbits, zooms or drifts within a shot; each view is a still tripod frame and the change between views happens only at the cut. Architecture, materials, props, lighting, time of day and layout remain identical across every shot, and every view shows the part of the place that lies on that side. No people, text, watermark or unrelated structures.`
        return {prompt: designed, beatTimes}
    }
    // every beat is its own locked-off setup at an explicit cut time - a bare list of views reads as one continuous
    // camera move around the place instead of separate shots
    const prompt = `Five distinct locked-off tripod views of the same empty location joined by hard cuts, with no camera movement inside any shot: ${description}. [Shot 1] A level, static front view of the location, matching the first frame. [Shot 2] At ${formatTimestamp(beatTimes[1]!)}, the shot cuts to a new locked-off camera position at the right side of the location, looking at it from the right, a completely different viewpoint. [Shot 3] At ${formatTimestamp(beatTimes[2]!)}, the shot cuts to a new locked-off camera position behind the location, looking back across it from the rear. [Shot 4] At ${formatTimestamp(beatTimes[3]!)}, the shot cuts to a new locked-off camera position at the left side of the location, looking at it from the left. [Shot 5] At ${formatTimestamp(beatTimes[4]!)}, the shot cuts to a wide establishing view showing the whole location from a distance. The camera never pans, tilts, dollies, orbits, zooms or drifts within a shot; each view is a still tripod frame and the change between views happens only at the cut. Architecture, materials, props, lighting, time of day and layout remain identical across every shot. No people, text, watermark or unrelated structures.`
    return {prompt, beatTimes}
}

/**
 * One frame index per beat, picked 65% into that beat's window (late enough that the hard cut has settled, before
 * the next one starts) - the beat timestamps are ones this project's own prompt asked the model to cut on, so
 * there's no need to search/score candidate frames the way the predecessor project did without that guarantee.
 */
export function selectFrameIndices(beatTimes: number[], totalFrames: number): number[] {
    return beatTimes.map((start, i) => {
        const end = beatTimes[i + 1] ?? totalFrames / FPS
        const target = start + (end - start) * 0.65
        return Math.min(totalFrames - 1, Math.max(0, Math.round(target * FPS)))
    })
}

/** Grid layout for a reference sheet - character panels are portrait, location panels landscape. */
export function sheetLayout(kind: 'character' | 'location'): { columns: number, panel: { width: number, height: number } } {
    return kind === 'character' ? {columns: 2, panel: {width: 288, height: 512}} : {columns: 3, panel: {width: 512, height: 288}}
}

/**
 * Composites the given frames into one grid image at `target`: each frame letterboxed (scaled to fit, padded with
 * black) into a `panel`-sized cell, `columns` wide, row-major. Pure ffmpeg (scale+pad+xstack) - no image library.
 */
export async function composeSheet(framePaths: string[], target: string, panel: { width: number, height: number }, columns: number) {
    if (!framePaths.length) throw new Error('composeSheet: no frames to compose')
    const scalePad = framePaths.map((_, i) =>
        `[${i}:v]scale=${panel.width}:${panel.height}:force_original_aspect_ratio=decrease,pad=${panel.width}:${panel.height}:(ow-iw)/2:(oh-ih)/2:color=black[p${i}]`,
    ).join(';')
    const layout = framePaths.map((_, i) => `${(i % columns) * panel.width}_${Math.floor(i / columns) * panel.height}`).join('|')
    const stackInputs = framePaths.map((_, i) => `[p${i}]`).join('')
    const filter = `${scalePad};${stackInputs}xstack=inputs=${framePaths.length}:layout=${layout}:fill=black[out]`

    mkdirSync(dirname(target), {recursive: true})
    const partial = target.replace(/\.png$/, '.partial.png')
    const {code, stderr} = await captureProcess(
        ['ffmpeg', '-y', '-v', 'error', ...framePaths.flatMap(f => ['-i', f]), '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', partial],
        {stdout: 'ignore', timeoutMs: SHORT_PROCESS_TIMEOUT_MS},
    )
    if (code !== 0) throw new Error(`ffmpeg failed to compose the reference sheet:\n${stderr}`)
    renameSync(partial, target)
}
