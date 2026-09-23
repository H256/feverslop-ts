import type {Assignment, Character, Location, MusicMap, Singing, Slot, StoryBeat, TimedWord} from "./project.ts";
import {frameAt} from "./frames.ts";

// Builds MiniMax H3 full-reference (ref2v) requests deterministically from the project data.
// Format: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md

const MAX_PICTURES = 9

// Asset paths, relative to the project folder. The pictures are placeholders -
// generate them from the Krea 2 prompts (output/assets.json) and drop them in these paths
export const pictureAsset = (kind: 'character' | 'location', id: string) => `assets/${kind}s/${id}.png`
// the first (ff) and last (lf) frame a rendered clip contributes to the final video - for extending clips later (fflf2va)
export const boundaryFrameAsset = (clipId: string, which: 'ff' | 'lf') => `assets/clips/${clipId}_${which}.png`
export const audioAsset = (clipId: string) => `output/audio/${clipId}.wav`
export const vocalsAsset = (clipId: string) => `output/audio/${clipId}.vocals.wav`

export type ClipRequest = {
    id: string,
    index: number,
    start: number,              // position in the song, seconds
    end: number,
    duration: number,
    frameStart: number,         // position on the song's frame grid (lib/frames.ts)
    frames: number,             // frames this clip contributes to the final video
    section: string,
    beatId: string,
    shots: { label: string, at: number, framing: string, camera: string, subjects: string[] }[],
    // performance mode: what is sung on screen and by whom, times relative to the clip start
    vocals?: { at: number, end: number, line: number, text: string, singers: { id: string, subject: string, speaker: string }[] }[],
    assets: {
        // kind, id, name and description: what the prompt says about the picture - for debugging
        pictures: { label: string, file: string, subject: string, kind: 'character' | 'location', id: string, name: string, description: string }[],
        // stem: cut from that stem instead of the full song
        audio: { label: string, file: string, songStart: number, songEnd: number, stem?: 'vocals' }[],
    },
    prompt: string,
}

type Input = {
    slots: Slot[],
    mapping: Assignment[],
    beats: StoryBeat[],
    characters: Character[],
    locations: Location[],
    characterDescriptions: Record<string, string>,   // not the image prompts - those describe the reference picture
    locationDescriptions: Record<string, string>,
    lookBrief: string,
    music: MusicMap,
    language: string,           // for <d>[...], e.g. "English"
    singing?: Singing,          // performance mode
    // beatId -> one distinct, progressing action per shot (step 9b) - replaces the beat.moments spread when given
    shotMoments?: Record<string, string[]>,
}

// Framings per beat kind, used in order for the shots of a clip
const framings: Record<StoryBeat['kind'], string[]> = {
    establish: ['wide establishing shot', 'medium wide shot', 'medium shot', 'close-up'],
    build: ['medium shot', 'medium close-up', 'over-the-shoulder shot', 'close-up'],
    hit: ['low-angle wide shot', 'close-up', 'medium shot', 'extreme close-up'],
    release: ['medium wide shot', 'medium close-up', 'wide shot', 'close-up'],
}
// a shot in which a line starts frames the singer's face
const singingFramings = ['medium shot', 'medium close-up', 'close-up']

// One camera move per shot, faster with more musical energy. Even "low" energy always keeps a slow, visible drift -
// a genuinely locked-off static frame reads as a still photo, not a shot, on anything longer than a second or two
const cameraMoves = {
    low: ['the camera dollies in slowly over the whole shot', 'the camera creeps almost imperceptibly closer', 'the camera cranes up slowly', 'the camera drifts sideways at a slow, even pace'],
    mid: ['the camera pushes in steadily', 'the camera tracks sideways at walking pace', 'the camera tilts up at a moderate speed', 'the camera arcs slowly around the subjects'],
    high: ['the handheld camera pushes in fast', 'the camera tracks quickly alongside the action', 'the camera cranes down fast toward the subjects', 'the camera arcs quickly around the subjects'],
}

const positions = ['on the left', 'in the center', 'on the right', 'in the background']

// C: how many castSubjects share a non-establishing shot - mostly a solo face or a two-character interaction,
// full-group shots stay rare so blocking doesn't default back to "everyone lined up" every shot
const blockingPattern = ['single', 'single', 'pair', 'group'] as const

// Picks who's in frame for a shot: `required` (e.g. the singers of this shot) always stays in, `named` (a
// character the story moment calls out by name) takes it alone when nobody must be kept in frame, otherwise a
// rotating window of `cast` is added around `required` - the window's start and size (see blockingPattern) both
// advance with `cursor`, a counter shared across the whole song, so the composition keeps changing shot to shot
// instead of resetting with every clip
function pickFocus<T>(cast: T[], required: T[], cursor: number, named: T | undefined): T[] {
    if (!required.length && named) return [named]
    if (cast.length <= 1) return cast.length ? cast : required
    const mode = blockingPattern[cursor % blockingPattern.length]!
    const size = Math.min(cast.length, mode === 'single' ? 1 : mode === 'pair' ? 2 : cast.length)
    const start = cursor % cast.length
    const window = Array.from({length: size}, (_, n) => cast[(start + n) % cast.length]!)
    return [...new Set([...required, ...window])]
}

// D: rotates through the energy level's camera moves but never repeats the immediately preceding shot's move,
// even across a slot or beat boundary - `cursor` and `last` are shared across the whole song
function nextCamera(level: keyof typeof cameraMoves, cursor: Record<keyof typeof cameraMoves, number>, last: string | undefined) {
    const pool = cameraMoves[level]
    let move = pool[cursor[level] % pool.length]!
    if (move === last && pool.length > 1) move = pool[++cursor[level] % pool.length]!
    cursor[level]++
    return move
}

// More cuts with more musical energy - shared by buildClipRequests and the step that sizes the per-shot moment lists
function shotCountFor(slot: Slot, beat: StoryBeat, opensScene: boolean) {
    const base = opensScene && beat.kind === 'establish' ? 1 : slot.energy < 0.45 ? 1 : slot.energy < 0.75 ? 2 : 4
    // a single shot covering 3+ bars runs long enough, at this kind of tempo, to read as a held photo rather than
    // a shot - cut it at least once even when energy or an establishing beat would otherwise keep it uncut
    const minShots = slot.bars >= 3 ? 2 : 1
    return Math.min(slot.bars, Math.max(base, minShots))
}

// Groups the slots into contiguous scenes (runs of slots mapped to the same beat), in story order
function* scenesOf(slots: Slot[], mapping: Assignment[], beatById: Map<string, StoryBeat>) {
    for (let i = 0; i < slots.length;) {
        const beat = beatById.get(mapping[i]!.beatId)!
        let sceneEnd = i
        while (sceneEnd < slots.length && mapping[sceneEnd]!.beatId === beat.id) sceneEnd++
        yield {beat, scene: slots.slice(i, sceneEnd)}
        i = sceneEnd
    }
}

// How many shots each beat will render in total - used to size the per-shot moment lists (step 9b)
export function countShotsPerBeat({slots, mapping, beats}: Pick<Input, 'slots' | 'mapping' | 'beats'>): Record<string, number> {
    const beatById = new Map(beats.map(b => [b.id, b]))
    const counts: Record<string, number> = {}
    for (const {beat, scene} of scenesOf(slots, mapping, beatById)) {
        counts[beat.id] = scene.reduce((sum, slot, k) => sum + shotCountFor(slot, beat, k === 0), 0)
    }
    return counts
}

export function buildClipRequests(input: Input): ClipRequest[] {
    const {slots, mapping, beats, music, shotMoments} = input
    const beatById = new Map(beats.map(b => [b.id, b]))
    const requests: ClipRequest[] = []
    const stateSoFar: string[] = []
    // C + D: blocking and camera state, carried across every shot of the whole song (not reset per clip or beat)
    let blockingCursor = 0
    let lastCamera: string | undefined
    const cameraCursor: Record<keyof typeof cameraMoves, number> = {low: 0, mid: 0, high: 0}

    for (const {beat, scene} of scenesOf(slots, mapping, beatById)) {
        const moments = beat.moments?.length ? beat.moments : splitSentences(beat.summary)
        // step 9b: one distinct action per shot, already sized to the beat's total shot count - sliced out in order
        const flat = shotMoments?.[beat.id]
        let shotCursor = 0

        scene.forEach((slot, k) => {
            const opensScene = k === 0
            const shotCount = shotCountFor(slot, beat, opensScene)
            const flatSlice = flat?.slice(shotCursor, shotCursor + shotCount)
            shotCursor += shotCount
            requests.push(buildClip(slot, beat, spread(moments, k, scene.length), flatSlice, [...stateSoFar], opensScene, input))
        })
        stateSoFar.push(...beat.stateAfter)
    }
    return requests

    function buildClip(slot: Slot, beat: StoryBeat, moments: string[], flatShotMoments: string[] | undefined, state: string[], opensScene: boolean, {characters, locations, characterDescriptions, locationDescriptions, lookBrief, language, singing}: Input): ClipRequest {
        const location = locations.find(l => l.id === beat.locationId)

        // performance mode: the parts of lines sung in this clip, each with its singer(s)
        const singersOf = new Map(singing?.lines.map(l => [l.line, l.singers]))
        const performed = singing && slot.vocals
            ? slot.vocals
                .map(v => ({...v, singerIds: (singersOf.get(v.line) ?? singing.singers).filter(id => characters.some(c => c.id === id))}))
                .filter(v => v.singerIds.length)
            : []
        // the singers are always on screen, first, in the order they sing - even if the beat forgot them
        const singerIds = [...new Set(performed.flatMap(v => v.singerIds))]
        const cast = [...singerIds, ...beat.characterIds.filter(id => !singerIds.includes(id))]
            .map(id => characters.find(c => c.id === id))
            .filter(c => c !== undefined)
            .slice(0, MAX_PICTURES - (location ? 1 : 0))

        // Subject N is always defined by Picture N
        const subjects = [
            ...(location ? [{label: '<Subject 1>', name: location.name, kind: 'location' as const, id: location.id}] : []),
            ...cast.map(c => ({label: '', name: c.name, kind: 'character' as const, id: c.id, role: c.role})),
        ].map((s, n) => ({
            ...s,
            label: `<Subject ${n + 1}>`,
            picture: `<Picture ${n + 1}>`,
            description: (s.kind === 'location' ? locationDescriptions : characterDescriptions)[s.id] ?? '',
        }))
        const locationSubject = subjects.find(s => s.kind === 'location')
        const castSubjects = subjects.filter(s => s.kind === 'character')

        // speaker ids (S1), (S2), ... in the order the singers first sing in this clip
        const singerSubjects = singerIds.map(id => castSubjects.find(s => s.id === id)).filter(s => s !== undefined)
        const speakerOf = (id: string) => `(S${singerIds.indexOf(id) + 1})`
        const voice = (s: { id: string, label: string }) => `${s.label} ${speakerOf(s.id)}`
        const vocals = performed.map(v => ({...v, singers: singerSubjects.filter(s => v.singerIds.includes(s.id))})).filter(v => v.singers.length)
        const performing = vocals.length > 0
        const voices = joinAnd(singerSubjects.map(voice))

        // Shots: more cuts with more energy, cut on downbeats
        const duration = round(slot.end - slot.start)
        const shotCount = shotCountFor(slot, beat, opensScene)
        const bars = music.downbeats.filter(t => t >= slot.start - 0.05 && t < slot.end - 0.05)
        const energyLevel = slot.energy < 0.4 ? 'low' : slot.energy < 0.7 ? 'mid' : 'high'
        const notes = slot.lyrics.filter(l => l.startsWith('(')).map(l => l.replace(/[()]/g, ''))

        const names = (s: { name: string }) => new RegExp(`\\b${escapeRegExp(s.name)}\\b`, 'g')
        const withLabels = (text: string) => castSubjects.reduce((t, s) => t.replace(names(s), s.label), text)

        // with vocals, a cut never falls into a sung word
        const cuts = avoidWords(
            Array.from({length: shotCount}, (_, j) => j === 0 ? 0 : round((bars[Math.floor(j * slot.bars / shotCount)] ?? slot.start) - slot.start)),
            vocals.flatMap(v => v.words), 120 / music.bpm, duration)
        const inShot = (j: number, t: number) => t >= cuts[j]! && (j === cuts.length - 1 || t < cuts[j + 1]!)

        let singingShots = 0
        const shots = cuts.map((at, j) => {
            const moment = flatShotMoments?.[j] ?? spread(moments, j, shotCount).join(' ')
            // the beat's establishing shot shows everyone, later shots vary the blocking (see pickFocus)
            const named = castSubjects.find(s => names(s).test(moment))
            const starting = vocals.filter(v => inShot(j, v.start))
            const continuing = vocals.filter(v => v.start < at && v.end > at)
            // while someone sings, they always stay in frame - the establishing shot still shows everyone, singers first
            const singersInShot = [...new Set([...continuing, ...starting].flatMap(v => v.singers))]
            const focus = opensScene && j === 0
                ? [...new Set([...singersInShot, ...castSubjects])]
                : pickFocus(castSubjects, singersInShot, blockingCursor++, named)
            // a shot with a line start frames the singer, with a calmer camera
            const framing = starting.length ? singingFramings[singingShots++ % singingFramings.length]! : framings[beat.kind][j % 4]!
            const cameraLevel = starting.length ? (energyLevel === 'high' ? 'mid' : 'low') : energyLevel
            const camera = nextCamera(cameraLevel, cameraCursor, lastCamera)
            lastCamera = camera
            return {label: `[Shot ${j + 1}]`, at, framing, camera, subjects: [...(locationSubject ? [locationSubject.label] : []), ...focus.map(s => s.label)], focus, singers: singersInShot, moment: withLabels(moment), starting, continuing}
        })

        // clip mode: the lyrics are a cue in <Audio 1> - with timing in the shot they're sung in, else spread evenly
        const sung = slot.lyrics.filter(l => !l.startsWith('('))
        const cueLines = (j: number) => slot.vocals
            ? slot.vocals.filter(v => inShot(j, v.start)).map(v => v.text)
            : sung.filter((_, n) => Math.floor(n * shots.length / sung.length) === j)
        const sings = (v: typeof vocals[number]) => `${joinAnd(v.singers.map(voice))} ${v.singers.length > 1 ? 'sing' : 'sings'} <d>[${language}] ${normalizeLyric(v.text)}</d>`

        const shotTexts = shots.map((shot, j) => {
            const moment = j > 0 && shot.moment === shots[j - 1]!.moment ? `The same action continues, seen closer: ${shot.moment}` : shot.moment
            const onSinger = shot.starting.length > 0 || shot.continuing.length > 0
            const focusLabels = joinAnd(shot.focus.map(s => s.label))
            const opening = j === 0
                ? onSinger
                    ? `${shot.label} A ${shot.framing} of ${focusLabels}${locationSubject ? ` in ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
                    : `${shot.label} A ${shot.framing}${locationSubject ? ` of ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
                // repeats the location on every cut, not just the first shot - otherwise a shot with no location
                // callout tends to fall back to the character reference pictures' plain grey background
                : `${shot.label} At ${formatTimestamp(shot.at)}, the shot cuts to a ${shot.framing}${shot.focus.length === 1 || onSinger ? ` of ${focusLabels}` : ''}${locationSubject ? `, still in ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
            const inFrame = shot.focus.length
                ? ` In frame: ${shot.focus.map((s, n) => `${s.label}, ${s.name}, ${shot.focus.length === 1 ? 'filling the frame' : positions[n % positions.length]}${shot.singers.includes(s) ? ', the face clearly visible' : ''}`).join('; ')}.`
                : ''

            if (performing) {
                const continuingSingers = [...new Set(shot.continuing.flatMap(v => v.singers))]
                const keepsSinging = continuingSingers.length ? ` ${joinAnd(continuingSingers.map(voice))} ${continuingSingers.length > 1 ? 'keep' : 'keeps'} singing.` : ''
                // "At 00:02.300, <Subject 2> (S1) sings <d>[English] ...</d> while <the story moment>"
                const lines = shot.starting.map((v, n) => ` At ${formatTimestamp(v.start)}, ${sings(v)}${n === 0 ? ` while ${continueWith(moment)}` : '.'}`).join('')
                return `${opening}${inFrame}${keepsSinging}${lines || ` ${moment}`}`.trim()
            }
            const lines = cueLines(j)
            const lyrics = lines.length
                ? ` When <Audio 1> reaches the phrase <d>[${language}] ${lines.map(normalizeLyric).join(' ')}</d>, the movement lands on the beat of the music.`
                : ''
            return `${opening}${inFrame} ${moment}${lyrics}`.trim()
        })

        const appearsIn = (label: string) => shots.filter(s => s.subjects.includes(label)).map(s => s.label).join(', ')
        const songPosition = `${formatTimestamp(slot.start)} to ${formatTimestamp(slot.end)} of the song`
        const seconds = String(Math.round(duration * 10) / 10)
        const score = `the ${slot.section} of the song at ${music.bpm} BPM with ${energyLevel} energy${notes.length ? `, ${notes.join(', ').toLowerCase()}` : ''}`

        const prompt = [
            'subject_definitions:',
            ...subjects.map(s => s.kind === 'location'
                ? `${s.label} is the ${s.name} environment in ${s.picture}: ${s.description}`.trim()
                : `${s.label} is ${s.name}, ${s.role}, the character in ${s.picture}; keep the face, build, hair, costume and colors from the picture: ${s.description}`.trim()),
            `<Audio 1> is the ${slot.section} section of the song (${songPosition}) and is reused as the complete final audio track.`,
            ...(performing ? [`<Audio 2> is the isolated lead vocal of this part of the song, the voice-timbre reference for ${voices}.`] : []),
            '',
            'summary:',
            `[reference generation + audio reuse${performing ? ' + audio reference' : ''}] The target video is ${seconds.startsWith('8') || seconds.startsWith('11') ? 'an' : 'a'} ${seconds}-second music-video clip${locationSubject ? ` set in ${locationSubject.label}` : ''}${castSubjects.length ? ` with ${joinAnd(castSubjects.map(s => s.label))}` : ''}: ${withLabels(beat.summary)}${performing ? ` ${voices} ${singerSubjects.length > 1 ? 'sing' : 'sings'} the lyrics on screen, lip-synced to the vocals of <Audio 1>.` : ''} It is cut in ${shots.length} shot${shots.length > 1 ? 's' : ''} on the downbeats of <Audio 1>.`,
            '',
            'retention_analysis:',
            ...subjects.map(s => `${s.label} (appears in ${appearsIn(s.label)}): fully_preserved - ${s.kind === 'location'
                ? `the layout, materials, colors and lighting of the ${s.name} are retained.`
                : `the identity, face, build, hair and costume of ${s.name} are retained.`}`),
            '<Audio 1>: fully_copy - <Audio 1> is reused 1:1 as the target video\'s complete final audio track.',
            // the guide: no (Sx) in retention_analysis
            ...(performing ? [`<Audio 2>: reference - its timbre, phrasing and timing drive the lip movements of ${joinAnd(singerSubjects.map(s => s.label))} without copying the signal.`] : []),
            '',
            'detailed_description:',
            styleOpening(lookBrief),
            ...(state.length ? [`Continuity from earlier scenes: ${state.map(withLabels).join('; ')}.`] : []),
            ...shotTexts,
            '',
            'overall_soundscape:',
            `Low ambience of the ${location?.name ?? 'scene'} sits under the music; footsteps, cloth and prop sounds follow the on-screen action.`,
            '',
            'non_diegetic_music:',
            // the lyrics themselves only go into <d> in detailed_description
            performing
                ? `<Audio 1> is directly reused as the complete audience-only score: the instrumental layer of ${score}; its vocals are sung on screen by ${voices}.`
                : `<Audio 1> is directly reused as the complete audience-only score: ${score}.`,
        ].join('\n')

        return {
            id: slot.id,
            index: slot.index,
            start: slot.start,
            end: slot.end,
            duration,
            frameStart: frameAt(slot.start),
            frames: frameAt(slot.end) - frameAt(slot.start),
            section: slot.section,
            beatId: beat.id,
            shots: shots.map(({focus, singers, moment, starting, continuing, ...shot}) => shot),
            ...(performing ? {
                vocals: vocals.map(v => ({
                    at: v.start,
                    end: v.end,
                    line: v.line,
                    text: v.text,
                    singers: v.singers.map(s => ({id: s.id, subject: s.label, speaker: speakerOf(s.id)})),
                })),
            } : {}),
            assets: {
                pictures: subjects.map(s => ({label: s.picture, file: pictureAsset(s.kind, s.id), subject: s.label, kind: s.kind, id: s.id, name: s.name, description: s.description})),
                audio: [
                    {label: '<Audio 1>', file: audioAsset(slot.id), songStart: slot.start, songEnd: slot.end},
                    ...(performing ? [{label: '<Audio 2>', file: vocalsAsset(slot.id), songStart: slot.start, songEnd: slot.end, stem: 'vocals' as const}] : []),
                ],
            },
            prompt,
        }
    }
}

/**
 * Moves every cut (but the first, at 0) that falls into a sung word to the nearest gap between words, if one is
 * within `maxShift` seconds - a cut in the middle of a word breaks the lip-sync.
 */
function avoidWords(cuts: number[], words: TimedWord[], maxShift: number, duration: number) {
    const sorted = [...words].sort((a, b) => a.start - b.start)
    const moved = [...cuts]
    for (let j = 1; j < moved.length; j++) {
        const t = moved[j]!
        const k = sorted.findIndex(w => w.start < t && w.end > t)
        if (k < 0) continue
        const word = sorted[k]!
        // just before or just after the word: in the middle of the gap, at most 0.1 s away from the word
        const before = word.start - Math.min(0.1, Math.max(0, word.start - (sorted[k - 1]?.end ?? 0)) / 2)
        const after = word.end + Math.min(0.1, Math.max(0, (sorted[k + 1]?.start ?? duration) - word.end) / 2)
        const lower = moved[j - 1]! + 0.5
        const upper = (moved[j + 1] ?? duration) - 0.5
        const options = [before, after].filter(o => Math.abs(o - t) <= maxShift && o > lower && o < upper)
        if (options.length) moved[j] = round(options.reduce((a, b) => Math.abs(a - t) <= Math.abs(b - t) ? a : b))
    }
    return moved
}

// "The smiths raise ..." reads on after "while" as "the smiths raise ..." - names and labels keep their case
function continueWith(moment: string) {
    return moment.replace(/^(The|A|An|They|He|She|His|Her|Their|It|Its)\b/, word => word.toLowerCase())
}

// the guide wants one or two style sentences before [Shot 1]
function styleOpening(lookBrief: string) {
    return splitSentences(lookBrief).slice(0, 2).join(' ')
}

function splitSentences(text: string) {
    return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
}

// items k of n: spreads a list evenly, repeating the nearest item if there are fewer items than parts
function spread<T>(items: T[], k: number, n: number): T[] {
    if (items.length === 0) return []
    const from = Math.floor(k * items.length / n)
    const to = Math.floor((k + 1) * items.length / n)
    return to > from ? items.slice(from, to) : [items[Math.min(from, items.length - 1)]!]
}

// the guide: basic punctuation only, every line ends with . ? or !
function normalizeLyric(line: string) {
    const clean = line.replace(/\.{2,}|…/g, '.').replace(/[~*]+/g, '').replace(/([!?.,])\1+/g, '$1').trim()
    return /[.?!]$/.test(clean) ? clean : `${clean}.`
}

function formatTimestamp(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`
}

const joinAnd = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('')
const round = (n: number) => Math.round(n * 1000) / 1000
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
