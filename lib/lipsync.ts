import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {avoidWords, clipCuts, HELD_NOTE_SEC, joinAnd, LATE_ONSET_SEC, normalizeLyric, shotCountFor} from './compose.ts'
import type {ProjectConfig} from './config.ts'
import {languageName} from './config.ts'
import {formatTimestamp, frameAt, round} from './frames.ts'
import {slotVocals} from './lyrics.ts'
import {type Project, shotActivityOf, type SlotVocal, type StoryBeat, type TimedWord} from './project.ts'
import {fileFingerprint} from './provenance.ts'
import {barCuts} from './shot-cuts.ts'
import {splitAtCuts, splitBySinger} from './singing-parts.ts'
import {MISSING_WORD_LEAD, voiceLead} from '../shared/timing-fit.ts'

// The lip-sync preview (#1016): the whole song as a close-up of a dummy singer on a plain background, rendered by the configured video workflow at a
// fraction of its size, from the vocals stem and the full song as a real clip gets them. It is made to judge the lyric timing - whether the mouth
// follows the words, and whether the model makes up singing where the stem only has bleed - before the real previews and the final render.
//
// It is built the way a real clip request is (lib/compose.ts), as far as that needs no plan: the cut of the song, the saved lyric timing, who sings which
// line, the shots of the clip (the cuts of the plan when there is one, else the ones on the bars), the singing heard before a line's first word, and the audio
// tracks - the vocals stem only in a clip somebody sings in, else the drums, as a real clip has them. No story, cast, look or picture is needed: the dummy is
// a subject defined by text alone.

/** The settings of the preview: what config.json says (lipsyncScale, lipsyncDummies, lipsyncDummy, lipsyncDummy2). */
export type LipsyncSettings = Pick<ProjectConfig, 'lipsyncScale' | 'lipsyncDummies' | 'lipsyncDummy' | 'lipsyncDummy2' | 'lyricsLanguage'>

/** The audio track a clip is given besides the full song: the vocals where somebody sings, else the drums (the whole song when the stems are not there). */
export type LipsyncTrack = 'vocals' | 'drums' | 'song'

export type LipsyncClip = {
    /** the id of the clip of the cut this is the preview of: slot-007 */
    id: string
    start: number
    end: number
    frameStart: number
    frames: number
    prompt: string
    /** the track it is given - as a real clip: the vocals only where somebody sings */
    track: LipsyncTrack
    /** the shots: where in the clip (seconds) each begins and which dummy (0 or 1) it shows */
    shots: {at: number; dummy: number}[]
    /** the sung pieces: where in the clip, which words, which dummy; `heard` is where the singing is heard, before the first word when the sound runs into it */
    vocals: {at: number; end: number; heard: number; line: number; text: string; dummy: number}[]
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

type Piece = {at: number; end: number; line: number; text: string; words: TimedWord[]; dummy: number; continues?: boolean; heard: number}

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
            ...piece,
            dummy: piece.singers.length ? dummyOf(piece.singers[0]!) : 0,
        })),
    )
}

/**
 * The cuts of every clip in its own time, as the real clip requests have them before the words are looked at: the plan's own (clipCuts - on the
 * bars and where the band breaks off) when the project is planned, else the cuts on the bars alone.
 */
function cutsOfClips(data: Project): Map<string, number[]> {
    const slots = data.timeline?.slots ?? []
    const music = data.music
    if (data.beats && data.mapping?.length === slots.length && data.cast && music) {
        try {
            return clipCuts({
                slots,
                mapping: data.mapping,
                beats: data.beats,
                characters: data.cast.characters,
                music,
                propActivity: shotActivityOf(data),
                shotMoments: data.shotMoments,
            })
        } catch {
            // a plan that does not fit the cut any more: the cuts on the bars, as before it
        }
    }
    const beat = {kind: 'build'} as Pick<StoryBeat, 'kind'>
    return new Map(slots.map((slot, k) => [slot.id, music ? barCuts(slot, shotCountFor(slot, beat, k === 0), music.downbeats) : [0]]))
}

/** Where the clip cuts from one dummy to the other where no cut of the shots is: halfway through the pause, not closer than MIN_SHOT_SEC to another cut. */
function withSingerCuts(cuts: number[], pieces: {start: number; end: number; dummy: number}[], duration: number): number[] {
    const out = [...cuts]
    for (let k = 1; k < pieces.length; k++) {
        const before = pieces[k - 1]!
        const piece = pieces[k]!
        if (piece.dummy === before.dummy) continue
        const at = round(piece.start - before.end > 0 ? (before.end + piece.start) / 2 : piece.start)
        if (at < MIN_SHOT_SEC || duration - at < MIN_SHOT_SEC || out.some(c => Math.abs(c - at) < MIN_SHOT_SEC)) continue
        out.push(at)
    }
    return out.sort((a, b) => a - b)
}

const subject = (dummy: number) => `<Subject ${dummy + 1}>`

/** The prompt of one clip, in the form of a real one (subject_definitions, summary, retention_analysis, detailed_description) - with the dummy for the cast. */
export function lipsyncPrompt(
    clip: {section: string; start: number; end: number; duration: number; track: LipsyncTrack},
    pieces: Piece[],
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
    const sentence = (p: Piece) => (p.continues && !p.text.endsWith('-') ? normalizeLyric(p.text).replace(/\.$/, '') : normalizeLyric(p.text))

    const shotText = shots.map((shot, j) => {
        const end = shots[j + 1]?.at ?? clip.duration
        const who = subject(shot.dummy)
        const inShot = pieces.filter(p => p.at >= shot.at && p.at < end)
        const opening =
            j === 0
                ? `[Shot ${j + 1}] A frontal close-up of ${who}'s head and shoulders, the face filling the frame, at eye level; the camera is locked in place.`
                : `[Shot ${j + 1}] At ${clipTime(shot.at)}, the shot cuts to a frontal close-up of ${who}'s head and shoulders, the face filling the frame, at eye level; the camera is locked in place.`
        const inFrame = ` In frame: ${who}, facing the camera, the face clearly visible. No other person is in the frame.`
        const notYet =
            inShot[0] && inShot[0].heard - shot.at >= LATE_ONSET_SEC
                ? ` Until ${clipTime(inShot[0].heard)}, ${who} does not sing yet: no lip-sync to ${track} before then.`
                : ''
        const lines = inShot
            .map(
                (p, n) =>
                    ` From ${clipTime(p.heard)} to ${clipTime(Math.min(p.end, end))}, ${who} sings <d>[${language}] ${sentence(p)}</d>${n === 0 ? ' while looking into the camera' : ''}.`,
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
            : ` ${who} does not sing in this shot: the lips stay closed and still.`
        return `${opening}${inFrame}${notYet}${lines}${held}${silent}`
    })

    // the track as a real clip defines it: the vocals where somebody sings, else the drums (or the song) that only time the cuts
    const layer = clip.track === 'song' ? "the song's full mix" : 'the isolated drum layer'
    const trackDefinition = vocalsWindow
        ? `${track} is the isolated lead vocal of the ${clip.section} section (${position}), the voice-timbre reference for ${names} - but ${names} only actually ${sings} from ${formatTimestamp(vocalsWindow.start)} to ${formatTimestamp(vocalsWindow.end)} of the song; outside that span within ${track}, keep lips closed and still.`
        : `${track} is ${layer} of the ${clip.section} section (${position}) - used to time the cuts; nobody sings in this clip, ${names} keeps the lips closed and still.`
    const trackRetention = vocalsWindow
        ? `${track}: partially_copy - its timbre and phrasing drive the lip movements of ${names}, confined to ${formatTimestamp(vocalsWindow.start)}-${formatTimestamp(vocalsWindow.end)}; elsewhere in the clip ${names} keeps lips closed and still.`
        : `${track}: weak_reference - only grounds the cut timing for the whole scene; nobody sings here.`

    return [
        'subject_definitions:',
        ...used.map(
            d =>
                `${subject(d)} is a dummy singer, ${description(d)}; there is no reference picture of ${subject(d)} - the face and the look are made up from this description alone, and stay the same in every shot.`,
        ),
        trackDefinition,
        '',
        'summary:',
        `[reference generation + audio reuse${vocalsWindow ? ' + audio reference' : ''}] The target video is ${/^[18]/.test(seconds) ? 'an' : 'a'} ${seconds}-second close-up clip of ${names}, ${used.length > 1 ? 'dummy singers' : 'a dummy singer'} in front of a plain, even grey background${vocalsWindow ? `: ${names} ${sings} the lyrics on screen, lip-synced to the vocals of ${track}` : `: ${names} does not sing`}. It is cut in ${shots.length} shot${shots.length > 1 ? 's' : ''} on the downbeats of the music.`,
        '',
        'retention_analysis:',
        ...used.map(
            d =>
                `${subject(d)} (appears in ${shots.flatMap((s, j) => (s.dummy === d ? [`[Shot ${j + 1}]`] : [])).join(', ')}): free - made up from the description alone; the same face in every shot.`,
        ),
        trackRetention,
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

/**
 * The previews of a project, one per clip of the cut - empty without the cut or the lyric timing. `vocalPeaks`: the loudness of the vocals stem, 100 values
 * a second (readFineWaveform): singing heard before a line's first word counts as heard, as in a real clip request.
 */
export function lipsyncRequests(
    data: Project,
    settings: LipsyncSettings,
    vocalPeaks?: number[],
    stems: {drums: boolean} = {drums: Boolean(data.stems?.drums)},
): LipsyncClip[] {
    const slots = data.timeline?.slots ?? []
    if (!data.lyricsTiming || !slots.length) return []
    const dummyOf = dummiesOf(data.singing, settings.lipsyncDummies)
    const baseCuts = cutsOfClips(data)
    return slots.map(slot => {
        const first = frameAt(slot.start)
        const frames = frameAt(slot.end) - first
        const duration = round(slot.end - slot.start)
        const pieces = piecesOf(slot, data, dummyOf)
        // with vocals, a cut never falls into a sung word
        const words = pieces.flatMap(p => p.words)
        const planned = baseCuts.get(slot.id) ?? [0]
        const cuts = withSingerCuts(data.music ? avoidWords(planned, words, 120 / data.music.bpm, duration) : planned, pieces, duration)
        // each shot sings the words heard in it: a line crossing a cut is split there; `heard`: where its singing is heard - before its first word
        // when the sound runs into it (a word the timing lost), never back into the cut or the words sung before it
        const shotPieces = pieces
            .flatMap(p => splitAtCuts(p, cuts))
            .map((p, _, all): Piece => {
                const cut = cuts.findLast(c => c <= p.start) ?? 0
                const before = Math.max(cut, ...all.filter(o => o !== p && o.start < p.start).map(o => o.end))
                const lead = vocalPeaks
                    ? voiceLead(
                          p.words.map(w => ({start: slot.start + w.start, end: slot.start + w.end})),
                          vocalPeaks,
                          slot.start + before,
                      )
                    : 0
                return {
                    at: p.start,
                    end: p.end,
                    line: p.line,
                    text: p.text,
                    words: p.words,
                    dummy: p.dummy,
                    continues: p.continues,
                    heard: lead >= MISSING_WORD_LEAD ? round(p.start - lead) : p.start,
                }
            })
        // a shot shows the dummy that sings in it, else the one before
        const shots = cuts.reduce<{at: number; dummy: number}[]>((out, at, j) => {
            const end = cuts[j + 1] ?? Infinity
            const here = shotPieces.find(p => p.at >= at && p.at < end)
            return [...out, {at, dummy: here?.dummy ?? out.at(-1)?.dummy ?? shotPieces[0]?.dummy ?? 0}]
        }, [])
        // the span in which the clip sings, in song seconds - as a real clip says it of its vocals
        const vocalsWindow = shotPieces.length ? {start: round(slot.start + shotPieces[0]!.heard), end: round(slot.start + shotPieces.at(-1)!.end)} : undefined
        // as a real clip: the vocals where somebody sings, else the drums that time the cuts (the song itself without the stems)
        const track: LipsyncTrack = shotPieces.length ? 'vocals' : stems.drums ? 'drums' : 'song'
        return {
            id: slot.id,
            start: slot.start,
            end: slot.end,
            frameStart: first,
            frames,
            prompt: lipsyncPrompt({section: slot.section, start: slot.start, end: slot.end, duration, track}, shotPieces, shots, settings, vocalsWindow),
            track,
            shots,
            vocals: shotPieces.map(({at, end, heard, line, text, dummy}) => ({at, end, heard, line, text, dummy})),
        }
    })
}

/** The audio files of the previews, by their content: the stems a clip can be given and the song. A stem that is not there counts as 'missing'. */
export type AudioPrints = {vocals: string; drums: string; song: string}

/** What a preview file is made from: the prompt, the span, the workflow, the size and the track it is given with the song. Another one makes it outdated. */
export function lipsyncFingerprint(
    clip: Pick<LipsyncClip, 'id' | 'prompt' | 'frames' | 'frameStart' | 'track'>,
    config: Pick<ProjectConfig, 'videoWorkflow' | 'videoResolution' | 'videoAspect' | 'videoSteps' | 'videoRefineSteps' | 'lipsyncScale'>,
    audio: AudioPrints,
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
        clip.track,
        audio[clip.track],
        audio.song,
    ]
}

export function audioPrints(dir: string, data: Project, songFile: string): AudioPrints {
    const print = (file: string | undefined) => (file && existsSync(join(dir, file)) ? fileFingerprint(join(dir, file)) : 'missing')
    return {vocals: print(data.stems?.vocals), drums: print(data.stems?.drums), song: fileFingerprint(songFile)}
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
