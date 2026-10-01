import type {Assignment, Character, Location, MusicMap, PropActivity, PropStem, Singing, Slot, StoryBeat, TimedWord} from "./project.ts";
import {formatTimestamp, frameAt, round} from "./frames.ts";
import {MAX_REF_AUDIOS, MAX_REFERENCE_IMAGES} from "../comfy/helpers.ts";

// Builds MiniMax H3 full-reference (ref2v) requests deterministically from the project data.
// Format: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md

// Asset paths, relative to the project folder. The pictures are placeholders -
// generate them from the Krea 2 prompts (output/assets.json) and drop them in these paths
export const pictureAsset = (kind: 'character' | 'location', id: string) => `assets/${kind}s/${id}.png`
// one reference image per member of a group character, instead of the single shared id - see computeMemberCounts
export const groupMemberId = (characterId: string, member: number) => `${characterId}-v${member}`

// Cap on how many distinct member images a group character gets, how ever many are visible at once in a beat -
// each one is a full extra image (and, with sequence sheets on, a full extra reference video) to generate.
export const MAX_GROUP_MEMBERS = 5

/**
 * How many distinct reference images a group character (Character.isGroup) needs: the most individuals of it
 * ever shown on screen together in one beat (beat.groupSize), capped at MAX_GROUP_MEMBERS. A group character with
 * no groupSize data anywhere still gets 2, so it doesn't silently fall back to the single-shared-image look this
 * is meant to fix. Non-group characters, and group characters that are only ever shown one at a time, get 1 -
 * the plain, unsuffixed picture id.
 */
export function computeMemberCounts(beats: StoryBeat[], characters: Character[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const char of characters) {
        if (!char.isGroup) continue
        const seen = beats.filter(b => b.characterIds.includes(char.id)).map(b => b.groupSize?.[char.id] ?? 2)
        counts[char.id] = Math.min(MAX_GROUP_MEMBERS, Math.max(1, ...(seen.length ? seen : [2])))
    }
    return counts
}
// the first (ff) and last (lf) frame a rendered clip contributes to the final video - for extending clips later (fflf2va)
export const boundaryFrameAsset = (clipId: string, which: 'ff' | 'lf') => `assets/clips/${clipId}_${which}.png`
// one file per stem per clip, e.g. output/audio/slot-006.guitar.wav - a clip can have anywhere from 1 to
// MAX_REF_AUDIOS tracks, not a fixed Audio 1/Audio 2, so this isn't a fixed pair of names any more
const trackAsset = (clipId: string, stem: string) => `output/audio/${clipId}.${stem}.wav`

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
        // stem: which isolated stem this track was cut from (always set - see the Track comment below) -
        // 'song' is the whole, unseparated song, used as the cut/blocking anchor when stems aren't available
        audio: { label: string, file: string, songStart: number, songEnd: number, stem?: 'vocals' | PropStem | 'song' }[],
    },
    prompt: string,
}

export type Input = {
    slots: Slot[],
    mapping: Assignment[],
    beats: StoryBeat[],
    characters: Character[],
    locations: Location[],
    characterDescriptions: Record<string, string>,   // not the image prompts - those describe the reference picture
    // group characters only (memberCounts[id] > 1, see computeMemberCounts): one description per member, matching
    // characterLookVariants - a shot referencing member N's picture must also use member N's own description, or
    // the clip prompt describes a different-looking member than the one in the picture it's bound to
    characterDescriptionVariants?: Record<string, string[]>,
    locationDescriptions: Record<string, string>,
    lookBrief: string,
    music: MusicMap,
    language: string,           // for <d>[...], e.g. "English"
    singing?: Singing,          // performance mode
    // beatId -> one distinct, progressing action per shot (step 9b) - replaces the beat.moments spread when given
    shotMoments?: Record<string, string[]>,
    propActivity?: PropActivity,
    // whether the song's stems were actually separated (config.alignLyrics) - when false, no drums/vocals/prop
    // stem is available and every clip's anchor track falls back to the whole, unseparated song instead
    stemsAvailable: boolean,
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

// one distinct label per cast member sharing a shot, front-to-back then left-to-right - covers up to
// MAX_REFERENCE_IMAGES - 1 (the most characters that can ever share one clip's reference set). A shorter
// cycle here used to repeat the same label (e.g. "on the right") for two different subjects in a crowded
// shot, which reads as "these two are the same/interchangeable" and lets the model conflate them - e.g. a
// named combatant and an unrelated background character rendered as if fighting each other.
const positions = [
    'in the front on the left', 'in the front, center', 'in the front on the right',
    'a step behind them on the left', 'a step behind them, center', 'a step behind them on the right',
    'further back on the left', 'further back on the right',
]

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

// Approximate real-time [start, end) window per shot of a beat, in shot order - shots are assumed evenly spread
// across their slot's duration. buildClip refines the exact cut points later (avoiding mid-word cuts etc.), but
// this coarse split is already enough to check a shot against detected stem activity before shot timing is final.
function shotWindowsPerBeat({slots, mapping, beats}: Pick<Input, 'slots' | 'mapping' | 'beats'>): Record<string, { start: number, end: number }[]> {
    const beatById = new Map(beats.map(b => [b.id, b]))
    const windows: Record<string, { start: number, end: number }[]> = {}
    for (const {beat, scene} of scenesOf(slots, mapping, beatById)) {
        windows[beat.id] = scene.flatMap((slot, k) => {
            const shotCount = shotCountFor(slot, beat, k === 0)
            return Array.from({length: shotCount}, (_, j) => ({
                start: round(slot.start + (slot.end - slot.start) * j / shotCount),
                end: round(slot.start + (slot.end - slot.start) * (j + 1) / shotCount),
            }))
        })
    }
    return windows
}

// A shot counts as "active" for a stem when detected activity covers at least a fifth of its estimated
// duration, or at least MIN_ACTIVE_SEC outright - a shot is a window, not a point, so a stray bleed of a few
// tens of milliseconds near its edge shouldn't flip it to active, but a real, short riff or hit inside an
// otherwise longer shot (which fails a >50%-of-duration bar) should.
const MIN_ACTIVE_SEC = 0.3
function isActive(window: { start: number, end: number }, ranges: { start: number, end: number }[]): boolean {
    const duration = window.end - window.start
    if (duration <= 0) return false
    const overlap = ranges.reduce((sum, r) => sum + Math.max(0, Math.min(window.end, r.end) - Math.max(window.start, r.start)), 0)
    return overlap >= duration * 0.2 || overlap >= MIN_ACTIVE_SEC
}

// Per beat, for every on-screen character whose prop is a musical instrument the song's stems were analyzed for:
// one active/inactive flag per shot of that beat, in shot order - grounding for step 9b so it only writes a
// character actively playing/using their prop when that instrument is actually audible at that point in the song.
// Characters without a stem-bound prop (a non-instrument prop, or no prop at all) never appear here.
export function propActivityPerBeat(
    {slots, mapping, beats, characters}: Pick<Input, 'slots' | 'mapping' | 'beats' | 'characters'>,
    activity: PropActivity,
): Record<string, { characterId: string, prop: string, activePerShot: boolean[] }[]> {
    const windows = shotWindowsPerBeat({slots, mapping, beats})
    const propped = characters.filter((c): c is Character & { prop: string, propStem: PropStem } =>
        Boolean(c.prop && c.propStem && activity[c.propStem]?.length))
    const result: Record<string, { characterId: string, prop: string, activePerShot: boolean[] }[]> = {}
    for (const beat of beats) {
        const onScreen = propped.filter(c => beat.characterIds.includes(c.id))
        if (!onScreen.length) continue
        const beatWindows = windows[beat.id] ?? []
        result[beat.id] = onScreen.map(c => ({
            characterId: c.id,
            prop: c.prop,
            activePerShot: beatWindows.map(w => isActive(w, activity[c.propStem]!)),
        }))
    }
    return result
}

export function buildClipRequests(input: Input): ClipRequest[] {
    const {slots, mapping, beats, characters, music, shotMoments} = input
    const beatById = new Map(beats.map(b => [b.id, b]))
    // >1 only for a group character (Character.isGroup) - which member image a given clip's subject resolves to
    const memberCounts = computeMemberCounts(beats, characters)
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

    function buildClip(slot: Slot, beat: StoryBeat, moments: string[], flatShotMoments: string[] | undefined, state: string[], opensScene: boolean, {characters, locations, characterDescriptions, characterDescriptionVariants, locationDescriptions, lookBrief, language, singing, propActivity, stemsAvailable}: Input): ClipRequest {
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
            .slice(0, MAX_REFERENCE_IMAGES - (location ? 1 : 0))

        // Subject N is always defined by Picture N. A group character (memberCounts[id] > 1) rotates through its
        // member pictures by slot index (groupMemberId) - computed once here so the picture file (pictureId) and
        // the description bound to it (from characterDescriptionVariants) always agree on which member this is;
        // resolving them separately previously let a shot's text describe one member while showing another's
        // picture, which the video model resolved by drifting the whole shot toward whichever member the text
        // described.
        function buildSubjects() {
            const subjects = [
                ...(location ? [{label: '<Subject 1>', name: location.name, kind: 'location' as const, id: location.id}] : []),
                ...cast.map(c => ({label: '', name: c.name, kind: 'character' as const, id: c.id, role: c.role, prop: c.prop, propStem: c.propStem})),
            ].map((s, n) => {
                const members = s.kind === 'character' ? memberCounts[s.id] ?? 1 : 1
                const variant = members > 1 ? slot.index % members : 0
                const pictureId = members > 1 ? groupMemberId(s.id, variant) : s.id
                const description = s.kind === 'location'
                    ? locationDescriptions[s.id] ?? ''
                    : characterDescriptionVariants?.[s.id]?.[variant] ?? characterDescriptions[s.id] ?? ''
                return {...s, label: `<Subject ${n + 1}>`, picture: `<Picture ${n + 1}>`, pictureId, description}
            })
            const locationSubject = subjects.find(s => s.kind === 'location')
            const castSubjects = subjects.filter(s => s.kind === 'character')

            // speaker ids (S1), (S2), ... in the order the singers first sing in this clip
            const singerSubjects = singerIds.map(id => castSubjects.find(s => s.id === id)).filter(s => s !== undefined)
            const speakerOf = (id: string) => `(S${singerIds.indexOf(id) + 1})`
            const voice = (s: { id: string, label: string }) => `${s.label} ${speakerOf(s.id)}`
            const vocals = performed.map(v => ({...v, singers: singerSubjects.filter(s => v.singerIds.includes(s.id))})).filter(v => v.singers.length)
            const performing = vocals.length > 0
            const voices = joinAnd(singerSubjects.map(voice))
            return {subjects, locationSubject, castSubjects, singerSubjects, speakerOf, voice, vocals, performing, voices}
        }

        const {subjects, locationSubject, castSubjects, singerSubjects, speakerOf, voice, vocals, performing, voices} = buildSubjects()

        // The vocals track's audio still covers the whole clip (see tracks below - same "always full clip length"
        // reasoning), but the prompt has to say in words where inside it the singing actually happens, or the
        // model reads an open-ended vocal reference as the singer performing for the whole clip.
        // Padded slightly so the on/offset word isn't clipped, clamped back into the clip's own span.
        const vocalsWindow = performing ? (() => {
            const pad = 0.2
            const from = slot.start + Math.min(...vocals.map(v => v.start))
            const to = slot.start + Math.max(...vocals.map(v => v.end))
            return {start: round(Math.max(slot.start, from - pad)), end: round(Math.min(slot.end, to + pad))}
        })() : undefined

        // Same idea as vocalsWindow, for an instrument track: a clip-wide "partially_copy" claim outweighs the
        // per-shot idle notes below when the instrument is only active in some of this clip's shots (e.g. a
        // guitarist who picks the guitar up partway through) - state the real window explicitly.
        const instrumentWindow = (stem: PropStem) => {
            const ranges = (propActivity?.[stem] ?? []).filter(r => r.end > slot.start && r.start < slot.end)
            if (!ranges.length) return undefined
            const pad = 0.2
            const from = Math.min(...ranges.map(r => r.start))
            const to = Math.max(...ranges.map(r => r.end))
            return {start: round(Math.max(slot.start, from - pad)), end: round(Math.min(slot.end, to + pad))}
        }

        // Multi-track audio: one <Audio N> per stem actually audible on screen, cut to the clip's full length
        // (never a narrower window - a short snippet has no clear position inside an 8.5s latent unless it
        // starts at the clip's own t=0, so "the whole clip, with real silence where nothing plays" is the only
        // version that's unambiguously aligned). Drums is always included, purely for cut/blocking timing, even
        // with no drummer on screen - every other stem only appears when a castSubject on that propStem is
        // actually active somewhere in this clip. Subjects sharing a propStem (two guitars, or several
        // characters lumped onto demucs' "other" stem) share the one track for that stem. Without separated
        // stems (alignLyrics: false - clip mode, nobody sings) there's no drums stem either, so the anchor
        // falls back to the whole, unseparated song - same role (cut/blocking timing only), weaker claim.
        // Order matters: whichever track drives an actual visible performance (vocals' lip movement, an active
        // instrument's playing motion - partially_copy) goes first; the always-present anchor track, which only
        // ever grounds cut/blocking timing (weak_reference, never a performance), goes last. Tested live -
        // drums-first measurably desynced lip movement from the vocals track even though the vocals audio
        // itself was untouched; putting the performance-driving track at <Audio 1> fixed it.
        type Track = { label: string, stem: 'drums' | PropStem | 'vocals' | 'song', subjects: typeof castSubjects }
        const clipActive = (stem: PropStem) => (propActivity?.[stem] ?? []).some(r => r.end > slot.start && r.start < slot.end)
        const propGroups = new Map<PropStem, typeof castSubjects>()
        for (const s of castSubjects) if (s.propStem) propGroups.set(s.propStem, [...(propGroups.get(s.propStem) ?? []), s])

        // MAX_REF_AUDIOS: MiniMaxH3ReferenceToVideo only has 4 ref_audio slots (see comfy/helpers.ts) - if a
        // clip somehow needs more tracks than that, drop the lowest-priority ones off the end (same order as
        // above: performance-driving tracks first, the anchor last) rather than erroring or silently overflowing
        // the autogrow inputs. A dropped subject keeps whatever idle/active staging text it already gets per
        // shot (see propNote below) - it just loses the audio anchor backing that text up.
        const allTracks: Track[] = [
            ...(performing ? [{label: '', stem: 'vocals' as const, subjects: singerSubjects}] : []),
            ...[...propGroups].filter(([stem]) => stem !== 'drums' && clipActive(stem)).map(([stem, subjects]) => ({label: '', stem, subjects})),
            stemsAvailable
                ? {label: '', stem: 'drums' as const, subjects: clipActive('drums') ? (propGroups.get('drums') ?? []) : []}
                : {label: '', stem: 'song' as const, subjects: []},
        ]
        const tracks = allTracks.slice(0, MAX_REF_AUDIOS)
        tracks.forEach((t, n) => t.label = `<Audio ${n + 1}>`)
        const anchorTrack = tracks.find(t => t.stem === 'drums' || t.stem === 'song')
        const vocalsTrack = performing ? tracks.find(t => t.stem === 'vocals') : undefined

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

        function buildShots() {
            let singingShots = 0
            return cuts.map((at, j) => {
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
        }

        const shots = buildShots()

        // clip mode: the lyrics are a cue in <Audio 1> - with timing in the shot they're sung in, else spread evenly
        const sung = slot.lyrics.filter(l => !l.startsWith('('))
        const cueLines = (j: number) => slot.vocals
            ? slot.vocals.filter(v => inShot(j, v.start)).map(v => v.text)
            : sung.filter((_, n) => Math.floor(n * shots.length / sung.length) === j)
        const sings = (v: typeof vocals[number]) => `${joinAnd(v.singers.map(voice))} ${v.singers.length > 1 ? 'sing' : 'sings'} <d>[${language}] ${normalizeLyric(v.text)}</d>`

        // "not playing" / "hands off it" reads as a negation to the video model, which tends to render the
        // negated action anyway (it renders "holding", not "not holding") - a concrete, affirmative hand/prop
        // position actually stops the miming. Rotated for variety across shots, never the same phrase twice
        // running. Phrased without assuming human anatomy or clothing (no "pocket", no "hip") - the performer
        // behind a propStem isn't always a person in a jacket. Split by whether the instrument is carried
        // (guitar, bass, ...) or stationary (drums, piano - nobody "holds" a drum kit at their side).
        const idlePropPoses: Partial<Record<PropStem, ((prop: string) => string)[]>> = {
            drums: [
                (prop: string) => `sits at the ${prop}, hands resting on the heads, motionless`,
                (prop: string) => `stands behind the ${prop}, sticks resting on it, still`,
                (prop: string) => `keeps still at the ${prop}, hands quiet on the rims`,
            ],
            piano: [
                (prop: string) => `sits at the ${prop}, hands resting on the keys, motionless`,
                (prop: string) => `stands beside the ${prop}, hands resting on its edge, still`,
                (prop: string) => `keeps still at the ${prop}, hands quiet on the keys`,
            ],
        }
        const idlePropPosesDefault = [
            (prop: string) => `rests a hand flat on the body of the ${prop}, motionless`,
            (prop: string) => `lets the ${prop} hang from its strap, one hand resting still on its body`,
            (prop: string) => `keeps a hand resting quietly on the body of the ${prop}, unmoving`,
            (prop: string) => `holds the ${prop} against their side, hand resting still on its body`,
        ]

        // Deterministic fallback for prop activity: step 9b writes one moment sentence per shot and can't know
        // ahead of time who pickFocus ends up putting in frame here - so a focused character's stem-bound prop
        // can go unaddressed even though 9b was given the same activity data. For anyone left unaddressed, state
        // their prop's real audio state plainly, using their own prop name - never a fixed verb per instrument.
        function propNote(focus: typeof castSubjects, start: number, end: number, moment: string, shotIndex: number): string {
            if (!propActivity) return ''
            const notes = focus
                .filter(s => s.propStem && s.prop && propActivity[s.propStem]?.length && !names(s).test(moment))
                .map(s => {
                    if (isActive({start, end}, propActivity[s.propStem!]!)) return `${s.label}, ${s.name}, is actively using the ${s.prop} right now.`
                    const poses = idlePropPoses[s.propStem!] ?? idlePropPosesDefault
                    return `${s.label}, ${s.name}, ${poses[shotIndex % poses.length]!(s.prop!)}.`
                })
            return notes.length ? ` ${notes.join(' ')}` : ''
        }

        // A couple of concrete, already-authored visual details from the location's own description (skipping
        // the first comma segment, which just repeats the name) - repeated whenever few enough characters share
        // the frame that they'd otherwise dominate it, since a close/medium shot with little else in it and only
        // a location *label* to go on tends to fall back to the characters' own reference pictures' plain grey
        // background instead - observed in practice not just for solo shots but for two-character medium-close-ups.
        const locationAnchor = locationSubject
            ? locationSubject.description.split(',').map(s => s.trim()).filter(Boolean).slice(1, 3).join(', ')
            : undefined
        const smallGroup = (n: number) => n > 0 && n <= 2

        function buildShotTexts() {
            return shots.map((shot, j) => {
                const moment = j > 0 && shot.moment === shots[j - 1]!.moment ? `The same action continues, seen closer: ${shot.moment}` : shot.moment
                const propClause = propNote(shot.focus, slot.start + shot.at, slot.start + (cuts[j + 1] ?? duration), moment, j)
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
                    ? ` In frame: ${shot.focus.map((s, n) => `${s.label}, ${s.name}, ${shot.focus.length === 1 ? 'filling the frame' : positions[n % positions.length]}${shot.singers.includes(s) ? ', the face clearly visible' : ''}`).join('; ')}.${locationAnchor && smallGroup(shot.focus.length) ? ` ${locationAnchor} still visible behind them.` : ''}`
                    : ''

                if (performing) {
                    const continuingSingers = [...new Set(shot.continuing.flatMap(v => v.singers))]
                    const keepsSinging = continuingSingers.length ? ` ${joinAnd(continuingSingers.map(voice))} ${continuingSingers.length > 1 ? 'keep' : 'keeps'} singing.` : ''
                    // "At 00:02.300, <Subject 2> (S1) sings <d>[English] ...</d> while <the story moment>"
                    const lines = shot.starting.map((v, n) => ` At ${formatTimestamp(v.start)}, ${sings(v)}${n === 0 ? ` while ${continueWith(moment)}` : '.'}`).join('')
                    return `${opening}${inFrame}${keepsSinging}${lines || ` ${moment}`}${propClause}`.trim()
                }
                const lines = cueLines(j)
                const lyrics = lines.length
                    ? ` When <Audio 1> reaches the phrase <d>[${language}] ${lines.map(normalizeLyric).join(' ')}</d>, the movement lands on the beat of the music.`
                    : ''
                return `${opening}${inFrame} ${moment}${lyrics}${propClause}`.trim()
            })
        }

        const shotTexts = buildShotTexts()

        function buildPromptText() {
            const appearsIn = (label: string) => shots.filter(s => s.subjects.includes(label)).map(s => s.label).join(', ')
            const songPosition = `${formatTimestamp(slot.start)} to ${formatTimestamp(slot.end)} of the song`
            const seconds = String(Math.round(duration * 10) / 10)
            const stemName: Record<Track['stem'], string> = {drums: 'drum', vocals: 'vocal', bass: 'bass', guitar: 'guitar', piano: 'piano', other: 'instrumental', song: 'full mix'}
            // beat.summary is written once for the whole scene and often describes how it opens (a character
            // arriving, emerging, appearing) - correct for the first clip of the scene, but repeating it verbatim
            // in later clips of the same scene tells the model everyone re-enters/re-appears each time, which
            // reads as the subjects vanishing and popping back in mid-scene. Only the opening clip gets it as-is.
            const sceneClause = opensScene
                ? withLabels(beat.summary)
                : `The scene continues directly from the previous clip, at the same time and place: ${castSubjects.length ? `${joinAnd(castSubjects.map(s => s.label))} are` : 'everything is'} already present and mid-action${locationSubject ? ` in ${locationSubject.label}` : ''} from the very first frame.`
            // reference-to-video models default to fading/popping subjects in over the first second unless told
            // otherwise. beat.summary is free to describe a genuine entrance (a rider appears on the horizon, a
            // ghost materializes) when the story calls for it - but most opening clips just start a new beat/shot
            // in the same ongoing performance, with no entrance word in the summary, and still need telling that
            // frame 1 already shows everyone. Continuation clips (sceneClause above) already say this explicitly.
            const entranceWords = /\b(emerge[sd]?|emerging|appear(s|ed|ing)?|enter(s|ed|ing)?|arriv(es?|ed|ing)|materiali[sz](es?|ed|ing)|steps? into (the )?frame|walks? into (the )?frame|fades? in|comes? into view)\b/i
            const alreadyPresentNote = opensScene && !entranceWords.test(sceneClause)
                ? 'Every listed subject is already fully visible, in position and mid-action, starting from the very first frame - unless a shot below explicitly describes a subject entering, arriving or emerging.'
                : undefined

            // beat.summary is free story text and often describes the whole scene as an ongoing performance
            // ("the musicians are already playing") for flavor - true only for whoever's stem is actually
            // active in this exact clip. Left uncorrected, that claim outweighs the per-shot idle notes below
            // (see shotTexts) since it comes first. Only opensScene gets beat.summary verbatim, so only there
            // does this correction apply - affirmative phrasing throughout, same as idlePropPoses above.
            const idleAtOpen = opensScene
                ? castSubjects
                    .filter(s => s.propStem && s.prop && !isActive({start: slot.start, end: slot.end}, propActivity?.[s.propStem!] ?? []))
                    .map(s => `${s.label} ${(idlePropPoses[s.propStem!] ?? idlePropPosesDefault)[0]!(s.prop!)}`)
                : []
            const sceneClauseFull = sceneClause + (idleAtOpen.length ? ` ${joinAnd(idleAtOpen)}.` : '')

            // subject_definitions line per track: what it is and, for an instrument/vocal track, who it drives
            const trackDefinition = (t: Track) => t.stem === 'drums'
                ? `${t.label} is the isolated drum layer of the ${slot.section} section (${songPosition})${t.subjects.length ? `, the performance reference for ${joinAnd(t.subjects.map(s => s.label))}'s drumming` : ''} - used to time the cuts and blocking to the beat${t.subjects.length ? ' as well' : ''}.`
                : t.stem === 'song'
                    ? `${t.label} is the ${slot.section} section (${songPosition}) of the song's full mix - used to time the cuts and blocking to the beat.`
                    : t.stem === 'vocals'
                        ? `${t.label} is the isolated lead vocal of the ${slot.section} section (${songPosition}), the voice-timbre reference for ${voices} - but ${voices} only actually sings from ${formatTimestamp(vocalsWindow!.start)} to ${formatTimestamp(vocalsWindow!.end)} of the song; outside that span within ${t.label}, keep lips closed and still.`
                        : (() => {
                            const window = instrumentWindow(t.stem as PropStem)
                            return `${t.label} is the isolated ${stemName[t.stem]} layer of the ${slot.section} section (${songPosition}), the performance reference for ${joinAnd(t.subjects.map(s => s.label))}${window ? ` - but ${joinAnd(t.subjects.map(s => s.label))} only actually play${t.subjects.length > 1 ? '' : 's'} from ${formatTimestamp(window.start)} to ${formatTimestamp(window.end)} of the song; outside that span within ${t.label}, keep the instrument still` : ''}.`
                        })()
            // retention_analysis line per track
            const trackRetention = (t: Track) => t.stem === 'drums'
                ? t.subjects.length
                    ? `${t.label}: partially_copy - its rhythm and hits drive the drumming motion of ${joinAnd(t.subjects.map(s => s.label))}; it also grounds the cut and blocking timing for the whole scene.`
                    : `${t.label}: weak_reference - only grounds the cut and blocking timing for the whole scene; drives no visible performance.`
                : t.stem === 'song'
                    ? `${t.label}: weak_reference - only grounds the cut and blocking timing for the whole scene; drives no visible performance.`
                    : t.stem === 'vocals'
                        ? `${t.label}: partially_copy - its timbre and phrasing drive the lip movements of ${voices}, confined to ${formatTimestamp(vocalsWindow!.start)}-${formatTimestamp(vocalsWindow!.end)}; elsewhere in the clip ${voices} keeps lips closed and still.`
                        : (() => {
                            const window = instrumentWindow(t.stem as PropStem)
                            return `${t.label}: partially_copy - its timbre and playing pattern drive the instrument motion of ${joinAnd(t.subjects.map(s => s.label))}${window ? `, confined to ${formatTimestamp(window.start)}-${formatTimestamp(window.end)}; elsewhere in the clip ${joinAnd(t.subjects.map(s => s.label))} keeps the instrument still` : ''}.`
                        })()

            return [
                'subject_definitions:',
                ...subjects.map(s => s.kind === 'location'
                    ? `${s.label} is the ${s.name} environment in ${s.picture}: ${s.description}`.trim()
                    // role ("plays warped rusted guitar behind the vocalist") describes behavior, not
                    // appearance - a subject definition that says a character "plays" something reads as a
                    // standing trait to the video model, and it keeps them miming that action even in shots
                    // that explicitly stage them as idle. Only look/identity belongs here; role stays out.
                    : `${s.label} is ${s.name}, the character in ${s.picture}; keep facial identity, build, hair, costume and colors from the picture, but let facial expression follow the action and emotion described in this shot: ${s.description}`.trim()),
                ...tracks.map(trackDefinition),
                '',
                'summary:',
                `[reference generation + audio reuse${performing ? ' + audio reference' : ''}] The target video is ${seconds.startsWith('8') || seconds.startsWith('11') ? 'an' : 'a'} ${seconds}-second music-video clip${locationSubject ? ` set in ${locationSubject.label}` : ''}${castSubjects.length ? ` with ${joinAnd(castSubjects.map(s => s.label))}` : ''}: ${sceneClauseFull}${vocalsTrack ? ` ${voices} ${singerSubjects.length > 1 ? 'sing' : 'sings'} the lyrics on screen, lip-synced to the vocals of ${vocalsTrack.label}.` : ''} It is cut in ${shots.length} shot${shots.length > 1 ? 's' : ''} on the downbeats of ${anchorTrack ? anchorTrack.label : 'the music'}.`,
                '',
                'retention_analysis:',
                ...subjects.map(s => `${s.label} (appears in ${appearsIn(s.label)}): fully_preserved - ${s.kind === 'location'
                    ? `the layout, materials, colors and lighting of the ${s.name} are retained.`
                    : `the facial identity, build, hair and costume of ${s.name} are retained, but expression is free to follow the shot's action.`}`),
                // the guide: no (Sx) in retention_analysis
                ...tracks.map(trackRetention),
                '',
                'detailed_description:',
                styleOpening(lookBrief),
                ...(alreadyPresentNote ? [alreadyPresentNote] : []),
                ...(state.length ? [`Continuity from earlier scenes: ${state.map(withLabels).join('; ')}.`] : []),
                ...shotTexts,
                '',
                'overall_soundscape:',
                `Low ambience of the ${location?.name ?? 'scene'} sits under the music; footsteps, cloth and prop sounds follow the on-screen action.`,
                '',
                // no single track is "the complete audience-only score" any more - each <Audio N> is just one
                // isolated stem, not a mix. Nothing meaningful to say here.
                'non_diegetic_music:',
                'N/A',
            ].join('\n')
        }

        const prompt = buildPromptText()

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
                // pictureId was resolved once in buildSubjects, together with the description bound to it - see the
                // comment there for why they have to be resolved as one pair, not separately
                pictures: subjects.map(s => ({label: s.picture, file: pictureAsset(s.kind, s.pictureId), subject: s.label, kind: s.kind, id: s.id, name: s.name, description: s.description})),
                // one whole-clip-length file per track, cut from that stem alone - see the Track comment above
                audio: tracks.map(t => ({label: t.label, file: trackAsset(slot.id, t.stem), songStart: slot.start, songEnd: slot.end, stem: t.stem})),
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
        if (lower >= upper) continue // neighbouring cuts are too close together to leave room for a move
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

const joinAnd = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('')
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
