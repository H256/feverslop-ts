import {escapeRegExp} from "./shot-plan.ts";
import {asBeatShots} from "./shot-plan.ts";
import {readTokens, replaceTokens} from "./refs.ts";
import type {Assignment, BeatShots, Character, Location, MusicMap, PropActivity, PropStem, ShotPlan, Singing, Slot, StoryBeat, TimedWord} from "./project.ts";
import {formatTimestamp, frameAt, round} from "./frames.ts";
import {MAX_REF_AUDIOS, MAX_REFERENCE_IMAGES} from "../comfy/helpers.ts";
import type {ProjectConfig} from "./config.ts";

// Builds MiniMax H3 full-reference (ref2v) requests deterministically from the project data.
// Format: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md

// Asset paths, relative to the project folder. The pictures are placeholders -
// generate them from the Krea 2 prompts (output/assets.json) and drop them in these paths
export const pictureAsset = (kind: 'character' | 'location', id: string) => `assets/${kind}s/${id}.png`
// one view of a location's reference sheet - the frame the sheet's panel was made from, not a crop of the small panel
export const locationViewAsset = (id: string, view: number) => `assets/sequence/locations/${id}/frames/frame_${String(view).padStart(2, '0')}.png`
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
        if (!char.isGroup || char.alike) continue
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
    // the clip goes on from the last frame of this clip (`<Picture N>` below, kind 'frame'): it can only be rendered after it
    startsFrom?: string,
    shots: { label: string, at: number, framing: string, camera: string, subjects: string[] }[],
    // performance mode: what is sung on screen and by whom, times relative to the clip start
    vocals?: { at: number, end: number, line: number, text: string, singers: { id: string, subject: string, speaker: string }[] }[],
    assets: {
        // kind, id, name and description: what the prompt says about the picture - for debugging
        pictures: { label: string, file: string, subject: string, kind: 'character' | 'location' | 'frame', id: string, name: string, description: string }[],
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
    // beatId -> the staged shots of the beat (step 11b: action, who is in the picture, where they stand) - replaces the
    // beat.moments spread when given. A plan from before the staging is a list of actions and works without the staging
    shotMoments?: Record<string, BeatShots | string[]>,
    propActivity?: PropActivity,
    // whether the song's stems were actually separated (config.alignLyrics) - when false, no drums/vocals/prop
    // stem is available and every clip's anchor track falls back to the whole, unseparated song instead
    stemsAvailable: boolean,
    continuity?: ProjectConfig['continuity'],   // default 'auto'
    // config.pinStartFrame: a continuing clip gets the last frame of the clip before it as its pinned first frame
    // (the render passes it to the workflow separately) - it is then not one of the reference pictures
    pinStartFrame?: boolean,
    // config.locationView: a clip's place picture is one view of the location's sheet (0-4): this one for every clip, or
    // with "auto" the one the shot planning chose for the first shot of the clip (shotViews); -1 or none = the sheet
    locationView?: number | 'auto',
    shotViews?: Record<string, number[]>,
}

// Whether the clips of the beat go on from each other's last frame without a cut (config.continuity)
export const isContinuous = (beat: StoryBeat, mode: ProjectConfig['continuity'] = 'auto') =>
    mode === 'always' || (mode === 'auto' && beat.continuous === true)

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

// the most facts a clip's "Continuity from earlier scenes" lists
const MAX_CONTINUITY_FACTS = 6

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
    // a piece of a fight clip (config.fightClips) is one shot
    if (slot.micro) return 1
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

// Per beat: one flag per shot of that beat for whether a lyric is sung during it (slot.vocals, slot-relative times),
// plus who the singers are - grounding for step 11b so a character only sings, cries out or voices anything on a shot
// where the song's vocals are actually audible. Without it a beat summary like "the soprano's voice joins" ends up
// as a rendered singing mouth over an instrumental stretch, since there is no vocals track to contradict it.
// Beats without singers on screen never appear here.
export function singingPerBeat(
    {slots, mapping, beats, singing}: Pick<Input, 'slots' | 'mapping' | 'beats' | 'singing'>,
): Record<string, { singerIds: string[], singingPerShot: boolean[] }> {
    if (!singing) return {}
    const windows = shotWindowsPerBeat({slots, mapping, beats})
    const slotById = new Map(slots.map(s => [s.id, s]))
    const result: Record<string, { singerIds: string[], singingPerShot: boolean[] }> = {}
    for (const beat of beats) {
        const singerIds = singing.singers.filter(id => beat.characterIds.includes(id))
        if (!singerIds.length) continue
        const sung = mapping.filter(m => m.beatId === beat.id).flatMap(m => slotById.get(m.slotId)?.vocals?.map(v => ({start: slotById.get(m.slotId)!.start + v.start, end: slotById.get(m.slotId)!.start + v.end})) ?? [])
        result[beat.id] = {singerIds, singingPerShot: (windows[beat.id] ?? []).map(w => isActive(w, sung))}
    }
    return result
}

export function buildClipRequests(input: Input): ClipRequest[] {
    const {slots, mapping, beats, characters, music, shotMoments} = input
    const beatById = new Map(beats.map(b => [b.id, b]))
    // Who a text is about: the beats and the shot plans write every character as {Name} (lib/refs.ts) and are read by their
    // tokens. Beats and plans from before the tokens (no "tokens" mark) name characters in plain words - only for those the
    // names are still looked for in the text, until the project plans them again (--redo=beats)
    const beatTokens = beats.length > 0 && beats.every(b => b.tokens === true)
    const legacyNames = (c: { name: string, id: string }) => new RegExp(`\\b(?:${escapeRegExp(c.name)}|${escapeRegExp(c.id)})\\b`, 'gi')
    const idsIn = (text: string, tokens: boolean) => tokens
        ? readTokens(text, characters).ids
        : characters.filter(c => new RegExp(legacyNames(c).source, 'i').test(text)).map(c => c.id)
    // >1 only for a group character (Character.isGroup) - which member image a given clip's subject resolves to
    const memberCounts = computeMemberCounts(beats, characters)
    const requests: ClipRequest[] = []
    // continuity facts in story order, with the beat and place they came from - see continuityFor
    const stateSoFar: { fact: string, beatId: string, locationId: string }[] = []
    // C + D: blocking and camera state, carried across every shot of the whole song (not reset per clip or beat)
    let blockingCursor = 0
    let lastCamera: string | undefined
    let lastFraming: string | undefined
    const cameraCursor: Record<keyof typeof cameraMoves, number> = {low: 0, mid: 0, high: 0}

    for (const {beat, scene} of scenesOf(slots, mapping, beatById)) {
        const moments = beat.moments?.length ? beat.moments : splitSentences(beat.summary)
        // step 9b: one distinct action per shot, already sized to the beat's total shot count - sliced out in order
        const staged = shotMoments?.[beat.id] ? asBeatShots(shotMoments[beat.id]!) : undefined
        const flat = staged?.shots
        let shotCursor = 0

        scene.forEach((slot, k) => {
            const opensScene = k === 0
            const shotCount = shotCountFor(slot, beat, opensScene)
            const flatSlice = flat?.slice(shotCursor, shotCursor + shotCount)
            const view = typeof input.locationView === 'number' ? input.locationView : input.locationView === 'auto' ? input.shotViews?.[beat.id]?.[shotCursor] : undefined
            shotCursor += shotCount
            // a clip of a continuous beat starts on the last frame of the clip before it
            const startsFrom = k > 0 && isContinuous(beat, input.continuity) ? scene[k - 1]!.id : undefined
            requests.push(buildClip(slot, beat, spread(moments, k, scene.length), flatSlice, continuityFor(beat), opensScene, startsFrom, input, staged?.staging, view, staged?.tokens === true))
        })
        stateSoFar.push(...beat.stateAfter.map(fact => ({fact, beatId: beat.id, locationId: beat.locationId})))
    }
    return requests

    // Every fact of the whole story piles up to 25+ lines that don't belong to the clip's place or contradict it (the
    // video model draws them in anyway) - a clip gets what happened at its own location and what the beat right
    // before it left behind, the most recent few. What a mirror shows is not filtered here by words: the beats prompt
    // and filmableRules already say that a mirror shows the plain reflection of the room and is never a fact of it
    function continuityFor(beat: StoryBeat) {
        const previous = beats[beats.findIndex(b => b.id === beat.id) - 1]
        return [...new Set(stateSoFar
            .filter(s => s.locationId === beat.locationId || s.beatId === previous?.id)
            .map(s => s.fact))].slice(-MAX_CONTINUITY_FACTS)
    }

    function buildClip(slot: Slot, beat: StoryBeat, moments: string[], flatShotMoments: ShotPlan[] | undefined, state: string[], opensScene: boolean, startsFrom: string | undefined, {characters, locations, characterDescriptions, characterDescriptionVariants, locationDescriptions, lookBrief, language, singing, propActivity, stemsAvailable, pinStartFrame}: Input, staging?: string, locationView?: number, planTokens = false): ClipRequest {
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
        // a piece of a fight clip has only the people of its own shot as references: fewer pictures, nobody to strike by mistake
        const shotIds = slot.micro && flatShotMoments?.length ? new Set(flatShotMoments.flatMap(s => s.characters ?? [])) : undefined
        // a shot plan can stage a character the beat's own list forgot: named in the prompt without a picture, the video
        // model invents one - so whoever a shot shows is in the cast, with the picture made for them
        const plannedIds = flatShotMoments?.flatMap(s => s.characters ?? []) ?? []
        // the same goes for the layout of the place and the continuity facts: "Runa and Floki sit at the fire" with no picture
        // for them drew two more copies of the singer. A character the text names is in the clip, with its picture
        const namedIds = shotIds ? [] : [...new Set([...idsIn(staging ?? '', planTokens), ...state.flatMap(fact => idsIn(fact, beatTokens))])]
        const cast = [...singerIds, ...[...beat.characterIds, ...plannedIds, ...namedIds].filter(id => !singerIds.includes(id) && (!shotIds || shotIds.size === 0 || shotIds.has(id)))]
            .filter((id, n, all) => all.indexOf(id) === n)
            .map(id => characters.find(c => c.id === id))
            .filter(c => c !== undefined)
            .slice(0, MAX_REFERENCE_IMAGES - (location ? 1 : 0) - (startsFrom && !pinStartFrame ? 1 : 0))

        // Subject N is always defined by Picture N. A group character (memberCounts[id] > 1) rotates through its
        // member pictures by slot index (groupMemberId) - computed once here so the picture file (pictureId) and
        // the description bound to it (from characterDescriptionVariants) always agree on which member this is;
        // resolving them separately previously let a shot's text describe one member while showing another's
        // picture, which the video model resolved by drifting the whole shot toward whichever member the text
        // described.
        function buildSubjects() {
            const subjects = [
                ...(location ? [{label: '<Subject 1>', name: location.name, kind: 'location' as const, id: location.id}] : []),
                ...cast.map(c => ({label: '', name: c.name, kind: 'character' as const, id: c.id, role: c.role, prop: c.prop, propStem: c.propStem, isGroup: c.isGroup, alike: c.alike})),
            ].map((s, n) => {
                const members = s.kind === 'character' ? memberCounts[s.id] ?? 1 : 1
                const variant = members > 1 ? slot.index % members : 0
                const pictureId = members > 1 ? groupMemberId(s.id, variant) : s.id
                const description = s.kind === 'location'
                    ? locationDescriptions[s.id] ?? ''
                    : characterDescriptionVariants?.[s.id]?.[variant] ?? characterDescriptions[s.id] ?? ''
                // how many of a group the beat shows together (Beat.groupSize) - stated in the subject definition so the
                // video model does not pick the number itself (it drew six of "the other five")
                const count = s.kind === 'character' && s.isGroup ? beat.groupSize?.[s.id] : undefined
                return {...s, label: `<Subject ${n + 1}>`, picture: `<Picture ${n + 1}>`, pictureId, description, count}
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
        // the last frame of the previous clip, after the subjects' pictures: a standalone <Picture N>, the first frame of [Shot 1]
        // Pinned: the frame is the video's real first frame, no longer a picture of its own. Given as a reference
        // picture as well, the model blended the same image in a second time, shifted - a ghost double of the
        // people and displaced wall patches that grew over the clip - so then the prompt only says that the
        // shot goes on from its first frame, without a `<Picture N>` to point at
        const framePicture = startsFrom && !pinStartFrame ? `<Picture ${subjects.length + 1}>` : undefined
        const pinnedFrame = startsFrom !== undefined && pinStartFrame === true

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

        // MAX_REF_AUDIOS: MiniMaxH3ReferenceToVideo only has 3 ref_audio slots (see comfy/helpers.ts) - if a
        // clip needs more tracks than that, drop instrument stems off the end of the performance-driving ones
        // (vocals first, then instruments) rather than erroring or overflowing the autogrow inputs. The anchor
        // always stays: it grounds cut/blocking timing. A dropped subject keeps whatever idle/active staging
        // text it already gets per shot (see propNote below) - it just loses the audio anchor backing it up.
        const performanceTracks: Track[] = [
            ...(performing ? [{label: '', stem: 'vocals' as const, subjects: singerSubjects}] : []),
            ...[...propGroups].filter(([stem]) => stem !== 'drums' && clipActive(stem)).map(([stem, subjects]) => ({label: '', stem, subjects})),
        ]
        const anchorTrackDef: Track = stemsAvailable
            ? {label: '', stem: 'drums' as const, subjects: clipActive('drums') ? (propGroups.get('drums') ?? []) : []}
            : {label: '', stem: 'song' as const, subjects: []}
        const tracks = [...performanceTracks.slice(0, MAX_REF_AUDIOS - 1), anchorTrackDef]
        tracks.forEach((t, n) => t.label = `<Audio ${n + 1}>`)
        const anchorTrack = tracks.find(t => t.stem === 'drums' || t.stem === 'song')
        const vocalsTrack = performing ? tracks.find(t => t.stem === 'vocals') : undefined

        // Shots: more cuts with more energy, cut on downbeats
        const duration = round(slot.end - slot.start)
        const shotCount = shotCountFor(slot, beat, opensScene)
        const bars = music.downbeats.filter(t => t >= slot.start - 0.05 && t < slot.end - 0.05)
        const energyLevel = slot.energy < 0.4 ? 'low' : slot.energy < 0.7 ? 'mid' : 'high'
        const notes = slot.lyrics.filter(l => l.startsWith('(')).map(l => l.replace(/[()]/g, ''))

        // a character of the clip becomes its <Subject N>, anybody else their plain name: from the {Name} tokens of the text,
        // or - in a beat or plan from before them - from the name or id ("Der Mann", "der-mann") written in it
        const withLabels = (text: string, tokens: boolean) => tokens
            ? replaceTokens(text, characters, c => castSubjects.find(s => s.id === c.id)?.label ?? c.name)
            : castSubjects.reduce((t, s) => t.replace(legacyNames(s), s.label), text)

        // with vocals, a cut never falls into a sung word
        const cuts = avoidWords(
            Array.from({length: shotCount}, (_, j) => j === 0 ? 0 : round((bars[Math.floor(j * slot.bars / shotCount)] ?? slot.start + (slot.end - slot.start) * j / shotCount) - slot.start)),
            vocals.flatMap(v => v.words), 120 / music.bpm, duration)
        const inShot = (j: number, t: number) => t >= cuts[j]! && (j === cuts.length - 1 || t < cuts[j + 1]!)

        function buildShots() {
            let singingShots = 0
            return cuts.map((at, j) => {
                const plan = flatShotMoments?.[j]
                const written = plan?.action ? {text: plan.action, tokens: planTokens} : {text: spread(moments, j, shotCount).join(' '), tokens: beatTokens}
                const moment = withLabels(written.text, written.tokens)
                // the beat's establishing shot shows everyone, later shots vary the blocking (see pickFocus)
                const firstNamed = idsIn(written.text, written.tokens)[0]
                const named = castSubjects.find(s => s.id === firstNamed)
                const starting = vocals.filter(v => inShot(j, v.start))
                const continuing = vocals.filter(v => v.start < at && v.end > at)
                // while someone sings, they always stay in frame - the establishing shot still shows everyone, singers first
                const singersInShot = [...new Set([...continuing, ...starting].flatMap(v => v.singers))]
                // staged by the planner: who is in the picture is its call, the singers of this shot are kept in
                const planned = plan?.characters?.map(id => castSubjects.find(s => s.id === id)).filter(s => s !== undefined)
                const focus = planned?.length
                    ? [...new Set([...singersInShot, ...planned])]
                    : opensScene && j === 0
                        ? [...new Set([...singersInShot, ...castSubjects])]
                        : pickFocus(castSubjects, singersInShot, blockingCursor++, named)
                // a shot with a line start frames the singer, with a calmer camera
                // a clip that goes on from the last frame of the one before has no cut at its start: the camera move and the
                // framing of that frame go on too, or the picture is seamless and the motion reverses (dolly in -> crane up)
                const goesOn = j === 0 && startsFrom !== undefined && lastCamera !== undefined && lastFraming !== undefined
                const framing = goesOn ? lastFraming! : plan?.framing ? plan.framing : starting.length ? singingFramings[singingShots++ % singingFramings.length]! : framings[beat.kind][j % 4]!
                const cameraLevel = starting.length ? (energyLevel === 'high' ? 'mid' : 'low') : energyLevel
                const camera = goesOn ? lastCamera! : plan?.hold ? 'the camera is held still, locked off' : plan?.camera ? withLabels(plan.camera, planTokens) : nextCamera(cameraLevel, cameraCursor, lastCamera)
                lastCamera = camera
                lastFraming = framing
                return {label: `[Shot ${j + 1}]`, at, framing, camera, plan, subjects: [...(locationSubject ? [locationSubject.label] : []), ...focus.map(s => s.label)], focus, singers: singersInShot, moment, starting, continuing}
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
                .filter(s => s.propStem && s.prop && propActivity[s.propStem]?.length && !moment.includes(s.label))
                .map(s => {
                    if (isActive({start, end}, propActivity[s.propStem!]!)) return `${s.label}, ${s.name}, is actively using the ${s.prop} right now.`
                    const poses = idlePropPoses[s.propStem!] ?? idlePropPosesDefault
                    return `${s.label}, ${s.name}, ${poses[shotIndex % poses.length]!(s.prop!)}.`
                })
            return notes.length ? ` ${notes.join(' ')}` : ''
        }

        // A couple of concrete, already-authored visual details from the location's own description (skipping
        // the first comma segment, which just repeats the name) - repeated in every shot with somebody in it, since a
        // shot with only a location *label* to go on tends to fall back to the characters' own reference pictures'
        // plain grey background instead - observed in practice for solo shots and two-character medium-close-ups, and
        // for groups: three people in a medium close-up and four in a wide shot came out as the reference figures
        // lined up on their grey backdrop (roots-of-the-world), which a group of that size had no anchor against.
        const locationAnchor = locationSubject
            ? locationSubject.description.split(',').map(s => s.trim()).filter(Boolean).slice(1, 3).join(', ')
            : undefined

        function buildShotTexts() {
            return shots.map((shot, j) => {
                const moment = j > 0 && shot.moment === shots[j - 1]!.moment ? `The same action continues, seen closer: ${shot.moment}` : shot.moment
                const propClause = propNote(shot.focus, slot.start + shot.at, slot.start + (cuts[j + 1] ?? duration), moment, j)
                // a singer in frame while nobody sings (an instrumental stretch, or between lines) gets a concrete mouth
                // position, same reasoning as the idle prop poses - the story text may still say they "cry out". Only the
                // lip-sync is ruled out, not the emotion: eyes, brows and posture stay free to follow the shot
                const silentSingers = shot.focus.filter(s => singing?.singers.includes(s.id) && !shot.singers.includes(s))
                const silentClause = silentSingers.length
                    ? ` ${silentSingers.length > 1 ? joinAnd(silentSingers.map(s => `${s.label} (${s.name})`)) : `${silentSingers[0]!.label}, ${silentSingers[0]!.name},`} ${silentSingers.length > 1 ? 'keep' : 'keeps'} their mouth closed, no lip movement and no sound, the face still showing the emotion of the moment through the eyes and brows.`
                    : ''
                const onSinger = shot.starting.length > 0 || shot.continuing.length > 0
                // while the singer sings, everyone else in the frame (a shadow, a creature of fog) sits it out - the video
                // model otherwise gives the lip-sync to them too, and the singer ends up in a duet with them
                const others = onSinger ? shot.focus.filter(s => !singing?.singers.includes(s.id)) : []
                const othersClause = others.length
                    ? ` ${others.length > 1 ? joinAnd(others.map(s => `${s.label} (${s.name})`)) : `${others[0]!.label}, ${others[0]!.name},`} ${others.length > 1 ? 'stay' : 'stays'} silent: no singing, no mouth movement, no sound from ${others.length > 1 ? 'them' : 'it'}.`
                    : ''
                const focusLabels = joinAnd(shot.focus.map(s => s.label))
                const opening = j === 0
                    ? onSinger
                        ? `${shot.label} A ${shot.framing} of ${focusLabels}${locationSubject ? ` in ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
                        : `${shot.label} A ${shot.framing}${locationSubject ? ` of ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
                    // repeats the location on every cut, not just the first shot - otherwise a shot with no location
                    // callout tends to fall back to the character reference pictures' plain grey background
                    : `${shot.label} At ${formatTimestamp(shot.at)}, the shot cuts to a ${shot.framing}${shot.focus.length === 1 || onSinger ? ` of ${focusLabels}` : ''}${locationSubject ? `, still in ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
                const fromFrame = j === 0 && framePicture ? ` The shot begins from ${framePicture} and goes on from there.` : ''
                // staged: each person's place, posture and movement as the planner wrote them (one position each); a shot without a
                // plan keeps the fixed positions
                const stagedPeople = shot.plan?.people
                const personInFrame = (s: typeof shot.focus[number], n: number) => {
                    const p = stagedPeople?.[s.id]
                    const face = shot.singers.includes(s) ? ', the face clearly visible' : ''
                    if (!shot.plan) return `${s.label}, ${s.name}, ${shot.focus.length === 1 ? 'filling the frame' : positions[n % positions.length]}${face}`
                    // somebody in the picture the planner gave no entry of their own: the shot's "rest" says what they do
                    if (!p) return `${s.label}, ${s.name}, in the frame${face}`
                    return `${s.label}, ${s.name}, ${[p.state, p.frame, p.motion].filter(Boolean).map(t => withLabels(t!, planTokens)).join('; ') || 'in the frame'}${face}`
                }
                // who is in the frame without a line of their own is busy with the event too, each in their own way - never
                // standing by: the video model otherwise lets them wait in their reference pose while the shot's two or
                // three people act
                const unstaged = shot.plan ? shot.focus.filter(s => !stagedPeople?.[s.id]) : []
                const restClause = unstaged.length
                    ? ` ${joinAnd(unstaged.map(s => s.label))} ${unstaged.length > 1 ? 'are' : 'is'} in it as well: ${shot.plan?.rest && !slot.micro ? withLabels(shot.plan.rest, planTokens).replace(/[.\s]+$/, '') : `${unstaged.length > 1 ? 'each takes' : 'takes'} part in what happens in the shot in their own way, none of them stands idle or only watches`}.`
                    : ''
                const viewClause = shot.plan?.view ? ` Camera position: ${withLabels(shot.plan.view, planTokens)}.` : ''
                const holdClause = shot.plan?.hold ? ' The framing stays the same from the first frame to the last: the same size of the faces, nobody steps closer or away, the camera does not move.' : ''
                const inFrame = shot.focus.length
                    ? `${viewClause} In frame: ${shot.focus.map(personInFrame).join('; ')}.${restClause}${locationAnchor ? ` ${locationAnchor} still visible behind them.` : ''}${holdClause}`
                    : `${viewClause}${holdClause}`

                if (performing) {
                    const continuingSingers = [...new Set(shot.continuing.flatMap(v => v.singers))]
                    const keepsSinging = continuingSingers.length ? ` ${joinAnd(continuingSingers.map(voice))} ${continuingSingers.length > 1 ? 'keep' : 'keeps'} singing.` : ''
                    // "At 00:02.300, <Subject 2> (S1) sings <d>[English] ...</d> while <the story moment>"
                    const lines = shot.starting.map((v, n) => ` At ${formatTimestamp(v.start)}, ${sings(v)}${n === 0 ? ` while ${continueWith(moment)}` : '.'}`).join('')
                    return `${opening}${fromFrame}${inFrame}${keepsSinging}${lines || ` ${moment}`}${silentClause}${othersClause}${propClause}`.trim()
                }
                const lines = cueLines(j)
                const lyrics = lines.length
                    ? ` When <Audio 1> reaches the phrase <d>[${language}] ${lines.map(normalizeLyric).join(' ')}</d>, the movement lands on the beat of the music.`
                    : ''
                return `${opening}${fromFrame}${inFrame} ${moment}${lyrics}${silentClause}${propClause}`.trim()
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
            // a piece of a fight clip tells what ITS shot does: the beat's summary names everybody ("seven hammers against a
            // dozen orcs"), and the video model fills the people it has no picture for with copies of the ones it has
            const sceneClause = slot.micro && flatShotMoments?.[0]?.action
                ? withLabels(flatShotMoments[0].action, planTokens)
                : opensScene
                ? withLabels(beat.summary, beatTokens)
                : `The scene continues directly from the previous clip, at the same time and place: ${castSubjects.length ? `${joinAnd(castSubjects.map(s => s.label))} are` : 'everything is'} already present and mid-action${locationSubject ? ` in ${locationSubject.label}` : ''} from the very first frame.${framePicture ? ` The video begins on ${framePicture} and goes on from it without a cut.` : pinnedFrame ? ' The video begins on the frame the previous clip ended on and goes on from it without a cut.' : ''}`
            // reference-to-video models default to fading/popping subjects in over the first second unless told
            // otherwise. beat.summary is free to describe a genuine entrance (a rider appears on the horizon, a
            // ghost materializes) when the story calls for it - but most opening clips just start a new beat/shot
            // in the same ongoing performance, with no entrance word in the summary, and still need telling that
            // frame 1 already shows everyone. Continuation clips (sceneClause above) already say this explicitly.
            // beat.entrance is the planner's own reading of the summary (a beat of an older project has none: everybody is there)
            const alreadyPresentNote = opensScene && beat.entrance !== true
                ? 'Every listed subject is already fully visible, in position and mid-action, starting from the very first frame - unless a shot below explicitly describes a subject entering, arriving or emerging.'
                : undefined

            // beat.summary is free story text and often describes the whole scene as an ongoing performance
            // ("the musicians are already playing") for flavor - true only for whoever's stem is actually
            // active in this exact clip. Left uncorrected, that claim outweighs the per-shot idle notes below
            // (see shotTexts) since it comes first. Only opensScene gets beat.summary verbatim, so only there
            // does this correction apply - affirmative phrasing throughout, same as idlePropPoses above.
            const idleAtOpen = opensScene
                ? castSubjects
                    .filter(s => s.propStem && s.prop && propActivity?.[s.propStem]?.length && !isActive({start: slot.start, end: slot.end}, propActivity[s.propStem]!))
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
                    : s.isGroup
                        // several individuals, not one: a group is never described as a single person
                        ? `${s.label} is ${s.name}, a group of ${s.count && s.count > 1 ? `${s.count}` : 'several'}${s.alike ? '' : ' different individuals'} (${s.alike ? `every one of them looks like the one in ${s.picture}` : `${s.picture} shows one of them; each of the others looks clearly different from it and from each other - another face, hair, build and clothing - and they share only the general style of the group`}${s.count && s.count > 1 ? `; there are ${s.count} of them in all, never more` : ''}); keep their build, skin, face, costume and colors from the picture, but let facial expression follow the action and emotion described in this shot: ${s.description}`.trim()
                        : `${s.label} is ${s.name}, the character in ${s.picture}; keep facial identity, build, hair, costume and colors from the picture, but let facial expression follow the action and emotion described in this shot: ${s.description}`.trim()),
                ...(framePicture ? [`${framePicture} is the first frame of [Shot 1], the last frame of the previous clip, showing the scene at the moment that clip ends: ${joinAnd([locationSubject, ...castSubjects].filter(s => s !== undefined).map(s => s.label))}.`] : []),
                ...tracks.map(trackDefinition),
                '',
                'summary:',
                `[reference generation${framePicture ? ' + keyframe completion' : ''} + audio reuse${performing ? ' + audio reference' : ''}] The target video is ${seconds.startsWith('8') || seconds.startsWith('11') ? 'an' : 'a'} ${seconds}-second music-video clip${locationSubject ? ` set in ${locationSubject.label}` : ''}${castSubjects.length ? ` with ${joinAnd(castSubjects.map(s => s.label))}` : ''}: ${sceneClauseFull}${vocalsTrack ? ` ${voices} ${singerSubjects.length > 1 ? 'sing' : 'sings'} the lyrics on screen, lip-synced to the vocals of ${vocalsTrack.label}.` : ''} It is cut in ${shots.length} shot${shots.length > 1 ? 's' : ''} on the downbeats of ${anchorTrack ? anchorTrack.label : 'the music'}.`,
                '',
                'retention_analysis:',
                ...subjects.map(s => `${s.label} (appears in ${appearsIn(s.label)}): fully_preserved - ${s.kind === 'location'
                    ? `the layout, materials, colors and lighting of the ${s.name} are retained.`
                    : `the facial identity, build, hair and costume of ${s.name} are retained; the plain grey studio backdrop and the sheet layout of its picture are discarded, but expression is free to follow the shot's action.`}`),
                ...(framePicture ? [`${framePicture} ([Shot 1] first frame): fully_preserved - the composition, camera position, lighting and the positions of everyone in it are kept at the start; the action then goes on from it.`] : []),
                // the guide: no (Sx) in retention_analysis
                ...tracks.map(trackRetention),
                '',
                'detailed_description:',
                styleOpening(lookBrief),
                ...(locationSubject ? [`The place stays as it is in ${locationSubject.label}: its features and props keep their place and shape, unless the action below changes them.`] : []),
                // a reference picture is identity only - without this a shot can come out as the pictures lined up on their own grey backdrop
                ...(locationSubject && castSubjects.length ? [`No grey studio backdrop and no lineup of the reference figures ever appears: every figure stands inside ${locationSubject.label}, at the positions described below.`] : []),
                // not in a piece of a fight clip: the layout is the whole beat's and names everybody, pictures or not
                ...(staging && !slot.micro ? [`Layout of the place: ${withLabels(staging, planTokens)}`] : []),
                ...(alreadyPresentNote ? [alreadyPresentNote] : []),
                // a fact that names somebody without a picture in this piece of a fight is left out
                ...(state.length ? [`Continuity from earlier scenes: ${state.filter(f => !slot.micro || idsIn(f, beatTokens).every(id => cast.some(c => c.id === id))).map(f => withLabels(f, beatTokens)).join('; ')}.`] : []).filter(line => !(slot.micro && line.endsWith(': .'))),
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
            ...(startsFrom ? {startsFrom} : {}),
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
                pictures: [
                    ...subjects.map(s => ({label: s.picture, file: s.kind === 'location' && locationView !== undefined && locationView >= 0 ? locationViewAsset(s.pictureId, locationView) : pictureAsset(s.kind, s.pictureId), subject: s.label, kind: s.kind, id: s.id, name: s.name, description: s.description})),
                    ...(startsFrom ? [{label: `<Picture ${subjects.length + 1}>`, file: boundaryFrameAsset(startsFrom, 'lf'), subject: '', kind: 'frame' as const, id: startsFrom, name: `last frame of ${startsFrom}`, description: ''}] : []),
                ],
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
    // only the first sentence: the second describes the world of every location - the video model draws the kitchen into the attic
    return splitSentences(lookBrief).slice(0, 1).join(' ')
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
    const clean = line.replace(/\.{2,}|…/g, '.').replace(/[~*]+/g, '').replace(/([!?.,])\1+/g, '$1').trim().replace(/[,;:]+$/, '')
    return /[.?!]$/.test(clean) ? clean : `${clean}.`
}

const joinAnd = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('')
