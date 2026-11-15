import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {HELD_NOTE_SEC, joinAnd, LATE_ONSET_SEC, normalizeLyric} from './compose.ts'
import type {ProjectConfig} from './config.ts'
import {languageName} from './config.ts'
import {formatTimestamp, frameAt, round} from './frames.ts'
import {slotVocals} from './lyrics.ts'
import type {Project, SlotVocal, TimedWord} from './project.ts'
import {fileFingerprint} from './provenance.ts'
import {splitBySinger} from './singing-parts.ts'

// The lip-sync preview (#1016): the whole song as a close-up of a dummy singer on a plain background, rendered by the configured video workflow at a
// fraction of its size, from the vocals stem and the full song as a real clip gets them. It is made to judge the lyric timing - whether the mouth
// follows the words, and whether the model invents singing where the stem only has bleed - before the real previews and the final render.
//
// It is built from the cut of the song (the timeline's clips), the saved lyric timing and who sings which line. Nothing of the plan - no story, cast,
// look or shots - is needed, and no reference picture goes in: the dummy is a subject defined by text alone.

/** The settings of the preview: what config.json says (lipsyncScale, lipsyncDummies, lipsyncDummy, lipsyncDummy2). */
export type LipsyncSettings = Pick<ProjectConfig, 'lipsyncScale' | 'lipsyncDummies' | 'lipsyncDummy' | 'lipsyncDummy2' | 'lyricsLanguage'>

export type LipsyncClip = {
    /** the id of the clip of the cut this is the preview of: slot-007 */
    id: string
    start: number
    end: number
    frameStart: number
    frames: number
    prompt: string
    /** the shots: where in the clip (seconds) each begins and which dummy (0 or 1) it shows */
    shots: {at: number; dummy: number}[]
    /** the sung pieces: where in the clip, which words, which dummy */
    vocals: {at: number; end: number; line: number; text: string; dummy: number}[]
}

/** The folder of the previews and the file of one of them, relative to the project. */
export const LIPSYNC_DIR = 'previews/lipsync'
export const lipsyncFile = (id: string) => `${LIPSYNC_DIR}/${id}.mp4`

/** Below this a cut between two dummies is not made: two shots that short are one blink. */
const MIN_SHOT_SEC = 0.6

const clipTime = (t: number) => formatTimestamp(Math.max(0, t))

/**
 * The dummy of each singer: the singers of `singing` in the order they are first named - the first is the first dummy, the next the second
 * (when two dummies are asked for), every further one shares the second. Without singers everything is the first.
 */
export function dummiesOf(singing: Project['singing'], dummies: 1 | 2): (id: string) => number {
    const ids = [...new Set([...(singing?.singers ?? []), ...(singing?.lines.flatMap(l => l.singers) ?? [])])]
    return id => (dummies === 1 ? 0 : Math.min(1, Math.max(0, ids.indexOf(id))))
}

/** The sung pieces of a clip, each cut where its singer changes: song data and the lines' singers in, clip-relative times out. */
function piecesOf(slot: {start: number; end: number}, data: Project, dummyOf: (id: string) => number) {
    const timing = data.lyricsTiming
    if (!timing) return []
    const singing = data.singing
    return slotVocals(slot, timing).flatMap((v: SlotVocal) =>
        splitBySinger(
            v,
            slot.start,
            singing?.lines.find(l => l.line === v.line),
            timing,
            singing?.singers ?? [],
        ).map(piece => ({
            at: piece.start,
            end: piece.end,
            line: piece.line,
            text: piece.text,
            words: piece.words,
            dummy: piece.singers.length ? dummyOf(piece.singers[0]!) : 0,
        })),
    )
}

/** Where the clip cuts from one dummy to the other: between the last word of one piece and the first of the next. */
function shotsOf(pieces: {at: number; end: number; dummy: number}[]): {at: number; dummy: number}[] {
    const shots = [{at: 0, dummy: pieces[0]?.dummy ?? 0}]
    for (let k = 1; k < pieces.length; k++) {
        const before = pieces[k - 1]!
        const piece = pieces[k]!
        if (piece.dummy === shots.at(-1)!.dummy) continue
        const at = round(piece.at - before.end > 0 ? (before.end + piece.at) / 2 : piece.at)
        if (at - shots.at(-1)!.at < MIN_SHOT_SEC) continue
        shots.push({at, dummy: piece.dummy})
    }
    return shots
}

const subject = (dummy: number) => `<Subject ${dummy + 1}>`

/** The prompt of one clip, in the form of a real one (subject_definitions, summary, retention_analysis, detailed_description) - with the dummy for the cast. */
export function lipsyncPrompt(
    clip: {section: string; start: number; end: number; duration: number},
    pieces: {at: number; end: number; text: string; words: TimedWord[]; dummy: number}[],
    shots: {at: number; dummy: number}[],
    settings: LipsyncSettings,
    vocalsWindow: {start: number; end: number} | undefined,
): string {
    const language = languageName(settings.lyricsLanguage) ?? 'English'
    const used = [...new Set(shots.map(s => s.dummy))].sort()
    const names = joinAnd(used.map(subject))
    const description = (dummy: number) => (dummy === 0 ? settings.lipsyncDummy : settings.lipsyncDummy2).trim().replace(/[.\s]+$/, '')
    const position = `${formatTimestamp(clip.start)} to ${formatTimestamp(clip.end)} of the song`
    const seconds = String(Math.round(clip.duration * 10) / 10)
    const sings = used.length > 1 ? 'sing' : 'sings'
    const track = '<Audio 1>'

    const shotText = shots.map((shot, j) => {
        const end = shots[j + 1]?.at ?? clip.duration
        const who = subject(shot.dummy)
        const inShot = pieces.filter(p => p.dummy === shot.dummy && p.at >= shot.at && p.at < end)
        const opening =
            j === 0
                ? `[Shot ${j + 1}] A frontal close-up of ${who}'s head and shoulders, the face filling the frame, at eye level; the camera is locked in place.`
                : `[Shot ${j + 1}] At ${clipTime(shot.at)}, the shot cuts to a frontal close-up of ${who}'s head and shoulders, the face filling the frame, at eye level; the camera is locked in place.`
        const inFrame = ` In frame: ${who}, facing the camera, the face clearly visible. No other person is in the frame.`
        const notYet =
            inShot[0] && inShot[0].at - shot.at >= LATE_ONSET_SEC
                ? ` Until ${clipTime(inShot[0].at)}, ${who} does not sing yet: no lip-sync to ${track} before then.`
                : ''
        const lines = inShot
            .map(
                (p, n) =>
                    ` From ${clipTime(p.at)} to ${clipTime(Math.min(p.end, end))}, ${who} sings <d>[${language}] ${normalizeLyric(p.text)}</d>${n === 0 ? ' while looking into the camera' : ''}.`,
            )
            .join('')
        const held = inShot
            .flatMap(p =>
                p.words
                    .filter(w => w.end - w.start >= HELD_NOTE_SEC)
                    .map(
                        w =>
                            ` From ${clipTime(Math.max(w.start, shot.at))} to ${clipTime(Math.min(w.end, end))}, ${who} holds the long note of "${w.text.replace(/[^\p{L}\p{N}]+$/u, '')}": one open vowel shape held, the mouth staying open in it for the whole note, only the jaw and the throat moving slightly.`,
                    ),
            )
            .join('')
        const silent = inShot.length
            ? ' Between the sung lines the lips are closed and still.'
            : ` ${who} does not sing in this shot: the lips stay closed and still, whatever ${track} contains.`
        return `${opening}${inFrame}${notYet}${lines}${held}${silent}`
    })

    return [
        'subject_definitions:',
        ...used.map(
            d =>
                `${subject(d)} is a dummy singer, ${description(d)}; there is no reference picture of ${subject(d)} - the face and the look are made up from this description alone, and stay the same in every shot.`,
        ),
        vocalsWindow
            ? `${track} is the isolated lead vocal of the ${clip.section} section (${position}), the voice-timbre reference for ${names} - but ${names} only actually ${sings} from ${formatTimestamp(vocalsWindow.start)} to ${formatTimestamp(vocalsWindow.end)} of the song; outside that span within ${track}, keep lips closed and still.`
            : `${track} is the isolated vocal stem of the ${clip.section} section (${position}); nobody sings in this clip - whatever sound ${track} has, ${names} keeps the lips closed and still.`,
        '',
        'summary:',
        `[reference generation + audio reuse + audio reference] The target video is ${/^[18]/.test(seconds) ? 'an' : 'a'} ${seconds}-second close-up clip of ${names}, ${used.length > 1 ? 'dummy singers' : 'a dummy singer'} in front of a plain, even grey background${vocalsWindow ? `: ${names} ${sings} the lyrics on screen, lip-synced to the vocals of ${track}` : `: ${names} does not sing`}. It is cut in ${shots.length} shot${shots.length > 1 ? 's' : ''}.`,
        '',
        'retention_analysis:',
        ...used.map(
            d =>
                `${subject(d)} (appears in ${shots.flatMap((s, j) => (s.dummy === d ? [`[Shot ${j + 1}]`] : [])).join(', ')}): free - made up from the description alone; the same face in every shot.`,
        ),
        vocalsWindow
            ? `${track}: partially_copy - its timbre and phrasing drive the lip movements of ${names}, confined to ${formatTimestamp(vocalsWindow.start)}-${formatTimestamp(vocalsWindow.end)}; elsewhere in the clip ${names} keeps lips closed and still.`
            : `${track}: weak_reference - nobody sings here; ${names} keeps the lips closed and still.`,
        '',
        'detailed_description:',
        'A plain studio: the background is an even, mid-grey surface with nothing on it, and nothing else is in the frame. Soft, even light on the face.',
        ...shotText,
        '',
        'overall_soundscape:',
        'The music only; no other sounds.',
        '',
        'non_diegetic_music:',
        'N/A',
    ].join('\n')
}

/** The previews of a project, one per clip of the cut - empty without the cut, the lyric timing or the vocals stem. */
export function lipsyncRequests(data: Project, settings: LipsyncSettings): LipsyncClip[] {
    const slots = data.timeline?.slots ?? []
    if (!data.lyricsTiming || !slots.length) return []
    const dummyOf = dummiesOf(data.singing, settings.lipsyncDummies)
    return slots.map(slot => {
        const first = frameAt(slot.start)
        const frames = frameAt(slot.end) - first
        const pieces = piecesOf(slot, data, dummyOf)
        const shots = shotsOf(pieces)
        // the span in which the clip sings, in song seconds - as a real clip says it of its vocals
        const vocalsWindow = pieces.length ? {start: round(slot.start + pieces[0]!.at), end: round(slot.start + pieces.at(-1)!.end)} : undefined
        const duration = round(slot.end - slot.start)
        return {
            id: slot.id,
            start: slot.start,
            end: slot.end,
            frameStart: first,
            frames,
            prompt: lipsyncPrompt({section: slot.section, start: slot.start, end: slot.end, duration}, pieces, shots, settings, vocalsWindow),
            shots,
            vocals: pieces.map(({at, end, line, text, dummy}) => ({at, end, line, text, dummy})),
        }
    })
}

/** What a preview file is made from: the prompt, the span, the workflow, the size and the two audio files. Another one makes it outdated. */
export function lipsyncFingerprint(
    clip: Pick<LipsyncClip, 'id' | 'prompt' | 'frames' | 'frameStart'>,
    config: Pick<ProjectConfig, 'videoWorkflow' | 'videoResolution' | 'videoAspect' | 'videoSteps' | 'videoRefineSteps' | 'lipsyncScale'>,
    audio: {vocals: string; song: string},
): unknown[] {
    return [
        'lipsync',
        clip.id,
        clip.prompt,
        clip.frames,
        clip.frameStart,
        config.videoWorkflow,
        config.videoResolution,
        config.videoAspect,
        config.videoSteps,
        config.videoRefineSteps,
        config.lipsyncScale,
        audio.vocals,
        audio.song,
    ]
}

/** The audio files of the previews, by their content: the vocals stem and the song. Missing ones count as 'missing'. */
export function audioPrints(dir: string, data: Project, songFile: string): {vocals: string; song: string} {
    const vocals = data.stems?.vocals ? join(dir, data.stems.vocals) : ''
    return {vocals: vocals && existsSync(vocals) ? fileFingerprint(vocals) : 'missing', song: fileFingerprint(songFile)}
}

/** What the sidecar of a preview file records: its fingerprint - undefined for a file made by hand or without one. */
export function recordedLipsync(file: string): {fingerprint?: string; scale?: number; size?: string} | undefined {
    const sidecar = `${file}.json`
    if (!existsSync(file) || !existsSync(sidecar)) return undefined
    try {
        return JSON.parse(readFileSync(sidecar, 'utf8')) as {fingerprint?: string; scale?: number; size?: string}
    } catch {
        return undefined
    }
}
