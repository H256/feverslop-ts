import {MAX_REFERENCE_IMAGES} from "../../comfy/helpers.ts";
import {languageName} from "../config.ts";
import {formatTimestamp, round} from "../frames.ts";
import {dialogueOf, type FilmClip} from "./coverage.ts";
import {mentions, withoutSentencesNaming} from "./names.ts";
import {filmPictureAsset, locationViewAsset, statePictureId} from "./pictures.ts";
import {characterOf, locationOf} from "./screenplay.ts";
import type {DialogueKind, Facing, FilmCast, FilmCharacter, Screenplay} from "./types.ts";

// which way a face is turned in the picture, said plainly after the person's place in the frame
const facingPhrase = (facing?: Facing) => facing === 'left' ? ', looking toward the left of the frame'
    : facing === 'right' ? ', looking toward the right of the frame'
        : facing === 'camera' ? ', looking into the lens'
            : facing === 'away' ? ', back to the camera' : ''

// Builds MiniMax H3 full-reference (ref2v) requests deterministically from the film's data - the same six sections as the
// music-video pipeline's lib/compose.ts (docs/minimax-h3-video-prompt-writing-guide.md), but with spoken dialogue instead of
// a song: no audio references, the video model speaks the lines itself from `<d>[Language] ...</d>`, with a speaker id and
// a voice description. The music-video code is not shared on purpose - it is built around stems and downbeats.

// the last frame of a rendered clip, which a continuing clip starts from
export const filmBoundaryFrame = (clipId: string) => `assets/clips/${clipId}_lf.png`

export type FilmClipRequest = {
    id: string,
    index: number,
    sceneId: string,
    seconds: number,
    frameStart: number,         // on the film's frame grid (lib/frames.ts)
    frames: number,             // frames this clip contributes to the final film
    startsFrom?: string,        // goes on from the last frame of this clip (`<Picture N>` below, kind 'frame')
    shots: { label: string, at: number, framing: string, camera: string, subjects: string[] }[],
    // every spoken line of the clip, in order: `at` is the start of its shot, speaker ids are numbered per clip
    dialogue: { at: number, line: number, speaker: string, speakerId: string, subject?: string, kind: DialogueKind, text: string }[],
    assets: {
        pictures: { label: string, file: string, subject: string, kind: 'character' | 'location' | 'frame', id: string, name: string, description: string }[],
    },
    prompt: string,
}

export type FilmInput = {
    screenplay: Screenplay,
    cast: FilmCast,
    clips: FilmClip[],
    soundscapes: Record<string, string>,             // scene id -> ambience
    stagings: Record<string, string>,                // scene id -> where everyone is, in what posture and clothes
    voices: Record<string, boolean>,                 // scene id -> the script itself has voices in it (whispers, a chant): wordless sounds are allowed there
    characterDescriptions: Record<string, string>,   // not the image prompts - those describe the reference picture
    locationDescriptions: Record<string, string>,
    locationViews?: Record<string, { name: string, shows: string }[]>,   // the views of the location sheet, when it has them
    lookBrief: string,
}

// one distinct label per character sharing a shot, front-to-back then left-to-right - a repeated one would read as "the
// same person" to the video model
const positions = [
    'in the front on the left', 'in the front, center', 'in the front on the right',
    'a step behind them on the left', 'a step behind them, center', 'a step behind them on the right',
    'further back on the left', 'further back on the right',
]

export function buildFilmClipRequests(input: FilmInput): FilmClipRequest[] {
    return input.clips.map(clip => buildClip(clip, input))
}

// does the plan of every shot say where its people are?
const shots_planned = (clip: FilmClip) => clip.shots.length > 0 && clip.shots.every(shot => shot.characters.length === 0 || Object.values(shot.people ?? {}).some(p => p.state))

function buildClip(clip: FilmClip, {screenplay, cast, characterDescriptions, locationDescriptions, locationViews, soundscapes, stagings, voices, lookBrief}: FilmInput): FilmClipRequest {
    const scene = screenplay.scenes.find(s => s.id === clip.sceneId)!
    const location = locationOf(cast, scene.location)
    const sceneLines = dialogueOf(scene)
    const voicesInScene = voices[clip.sceneId] === true

    // the picture slots: the place, then everyone who is in a shot of the clip, then the frame the clip goes on from
    const visibleIds = [...new Set(clip.shots.flatMap(s => s.characters))]
    const room = MAX_REFERENCE_IMAGES - (location ? 1 : 0) - (clip.startsFrom ? 1 : 0)
    const characters = visibleIds.map(id => cast.characters.find(c => c.id === id)).filter(c => c !== undefined).slice(0, room)

    // With designed views the place's picture is the one view the clip starts in - not the sheet of all of them, which the video model shows back as a grid of four
    const views = location ? locationViews?.[location.id] : undefined
    const pictured = views?.length ? Math.min(views.length, Math.max(1, clip.shots.find(s => s.placeView)?.placeView ?? 1)) : undefined
    const subjects = [
        ...(location ? [{kind: 'location' as const, id: location.id, pictureId: location.id, ...(pictured ? {file: locationViewAsset(location.id, pictured)} : {}), name: location.name, description: `${locationDescriptions[location.id] ?? location.description}${pictured ? ` The picture shows the place ${views![pictured - 1]!.name}.` : ''}`.trim()}] : []),
        ...characters.map(c => {
            // the look the character is in when they first appear in this clip - the clip has one picture of them
            const stateId = clip.shots.find(s => s.characters.includes(c.id))?.states?.[c.id]
            const pictureId = stateId && c.states?.some(s => s.id === stateId) ? statePictureId(c.id, stateId) : c.id
            return {kind: 'character' as const, id: c.id, pictureId, name: c.name, description: characterDescriptions[pictureId] ?? characterDescriptions[c.id] ?? c.appearance}
        }),
    ].map((s, n) => ({...s, label: `<Subject ${n + 1}>`, picture: `<Picture ${n + 1}>`}))
    const locationSubject = subjects.find(s => s.kind === 'location')
    const castSubjects = subjects.filter(s => s.kind === 'character')
    const subjectOf = (characterId: string) => castSubjects.find(s => s.id === characterId)
    // characters of the film who have no picture in this clip: the text of the clip does not name them (the model would draw a stranger)
    const unpictured = cast.characters.filter(c => !c.voiceOnly && !subjectOf(c.id))
    // The staging is the layout of the place. Where the plan says where everybody is per shot (people.state), the sentences of the staging that
    // place people are left out: "true in every shot" put a person into a close-up twice - once as the close-up, once standing where the staging has them.
    const planned = shots_planned(clip)
    const stagingFull = stagings[clip.sceneId] ?? ''
    const stagingText = planned
        ? withoutSentencesNaming(stagingFull, cast.characters.filter(c => !c.voiceOnly))
        : withoutSentencesNaming(stagingFull, unpictured)
    const framePicture = clip.startsFrom ? `<Picture ${subjects.length + 1}>` : undefined

    // speaker ids (S1), (S2), ... in the order of the spoken lines of this clip - numbered per clip, not per character
    type Spoken = { at: number, line: number, key: string, character?: FilmCharacter, kind: DialogueKind, text: string, delivery?: string, language: string }
    let cursor = 0
    const shots = clip.shots.map((shot, j) => {
        const at = round(cursor)
        cursor += shot.seconds
        const spoken: Spoken[] = shot.lines.map((n, k) => {
            const line = sceneLines[n]!
            if (line.type !== 'dialogue') throw new Error('not a dialogue line')
            const character = characterOf(cast, line.speaker)
            return {at, line: n, key: character?.id ?? line.speaker, character, kind: line.kind, text: shot.texts?.[k] ?? line.text, delivery: line.delivery || shot.deliveries?.[k] || undefined, language: line.language ?? screenplay.language}
        })
        return {...shot, label: `[Shot ${j + 1}]`, at, spoken, focus: shot.characters.map(subjectOf).filter(s => s !== undefined)}
    })
    const speakers = [...new Set(shots.flatMap(s => s.spoken.map(l => l.key)))]
    const speakerId = (key: string) => `(S${speakers.indexOf(key) + 1})`

    const names = (s: { name: string }) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(s.name)}(?![\\p{L}\\p{N}])`, 'gu')
    const withLabels = (text: string) => castSubjects.reduce((t, s) => t.replace(names(s), s.label), text)

    // "<Subject 2> (S1) says in ..." for someone with a picture in this clip, else the speaker is only a voice
    const who = (line: Spoken) => {
        const subject = line.character ? subjectOf(line.character.id) : undefined
        return subject ? `${subject.label} ${speakerId(line.key)}` : `The speaker ${speakerId(line.key)}`
    }
    const voiceOf = (line: Spoken) => voicePhrase(line.character?.voice ?? 'a clear, natural voice')
    const lineText = (line: Spoken, onScreen: boolean) => {
        const language = languageName(line.language) ?? 'English'
        const dialogue = `<d>[${language}] ${normalizeLine(line.text)}</d>`
        const delivery = line.delivery ? `, ${line.delivery},` : ','
        if (line.kind === 'voiceover') return `${who(line)} says in an off-screen voiceover, in ${voiceOf(line)}${delivery} ${dialogue} - heard over the picture, not spoken by anyone in it: everybody's lips stay completely closed.`
        if (line.kind === 'offscreen') return `${who(line)}, off-screen, says in ${voiceOf(line)}${delivery} ${dialogue}`
        // the speaker is not in this picture (a cutaway to hands, an object, a place): the words come from outside the frame
        if (!onScreen) return `${who(line)}, off-screen, says in ${voiceOf(line)}${delivery} ${dialogue} - nobody in the picture speaks it.`
        return `${who(line)} says in ${voiceOf(line)}${delivery} ${dialogue}`
    }

    const shotTexts = shots.map((shot, j) => {
        const focusLabels = joinAnd(shot.focus.map(s => s.label))
        const opening = j === 0
            ? `${shot.label} A ${shot.framing}${locationSubject ? ` of ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
            // the place is repeated on every cut - a shot without it tends to fall back to the plain grey background of the character pictures
            : `${shot.label} At ${formatTimestamp(shot.at)}, the shot cuts to a ${shot.framing}${shot.focus.length === 1 ? ` of ${focusLabels}` : ''}${locationSubject ? `, still in ${locationSubject.label}, the ${locationSubject.name}` : ''}; ${shot.camera}.`
        const fromFrame = j === 0 && framePicture ? ` The shot begins from ${framePicture} and goes on from there.` : ''
        const inFrame = shot.focus.length
            ? ` In frame: ${shot.focus.map((s, n) => `${s.label}, ${s.name}, ${shot.people?.[s.id]?.frame ?? (shot.focus.length === 1 ? 'filling the frame' : positions[n % positions.length])}${facingPhrase(shot.people?.[s.id]?.facing)}`).join('; ')}.`
            : ''
        // where the camera is, and where everyone is and what they hold at the start of the shot (what the shots before changed is already so)
        const placeView = shot.placeView ? locationViews?.[location?.id ?? '']?.[shot.placeView - 1] : undefined
        const view = shot.view ? ` The camera is ${withLabels(shot.view)}.${placeView && locationSubject ? (shot.placeView === pictured ? ` The background is ${locationSubject.picture}.` : ` The background is the place seen ${placeView.name} - that side is not in the picture, it follows from the place's description.`) : ''}` : ''
        // a person who is only a shoulder at the near edge of the picture (an over-the-shoulder listener) is drawn from "In frame" alone: said where they really stand, the video model draws a second, whole person there
        const starts = shot.focus.filter(s => shot.people?.[s.id]?.state && !shot.people[s.id]!.foreground)
        // a held shot: what the picture IS from the first frame to the last, said positively - "no push-in" does not hold the video model back, a picture that stays does
        const holdClause = shot.hold && shot.focus.length
            ? ` A fixed tripod shot: the framing is the same from the first frame to the last - ${shot.focus.length > 1 ? joinAnd(shot.focus.map(s => s.label)) : shot.focus[0]!.label} keep${shot.focus.length > 1 ? '' : 's'} the same size and the same place in the frame, standing on the same spot, and only the head, the mouth and the expression move.`
            : ''
        const start = starts.length ? ` At the start of the shot: ${starts.map(s => `${s.label} ${withLabels(shot.people![s.id]!.state!)}`).join('; ')}.` : ''
        const moving = shot.focus.filter(s => shot.people?.[s.id]?.motion && !shot.people[s.id]!.foreground)
        const motion = moving.length ? ` During the shot: ${moving.map(s => `${s.label} ${withLabels(shot.people![s.id]!.motion!)}`).join('; ')}.` : ''
        const lines = shot.spoken.map(l => lineText(l, !l.character || shot.focus.some(f => f.id === l.character!.id))).join(' ')
        // nobody but the speaker moves their mouth - the video model otherwise gives the words to someone else in the frame too
        const speaking = new Set(shot.spoken.filter(l => l.kind === 'spoken' && l.character).map(l => l.character!.id))
        const silent = speaking.size ? shot.focus.filter(s => !speaking.has(s.id)) : []
        const silentClause = silent.length
            ? ` ${silent.length > 1 ? joinAnd(silent.map(s => `${s.label} (${s.name})`)) : `${silent[0]!.label}, ${silent[0]!.name},`} ${silent.length > 1 ? 'keep' : 'keeps'} their mouth closed, no lip movement and no sound, the face still showing what they feel through the eyes and brows.`
            : ''
        // The video model makes up speech - a babble of invented words - for people it shows when the prompt does not say that nobody
        // speaks. Every shot without a line of dialogue says so.
        // (voices the script itself describes - whispers, a chant - stay: wordless and indistinct)
        const noSpeech = !shot.spoken.length && shot.focus.length
            ? (voicesInScene ? ' No words are spoken in this shot: any voices, whispers or chanting in it are indistinct and wordless.' : ' Nobody speaks in this shot: mouths stay closed, and no voices, murmuring or speech are heard.')
            : ''
        return `${opening}${fromFrame}${view}${inFrame}${start}${motion}${holdClause} ${withLabels(shot.action)}${lines ? ` ${lines}` : ''}${silentClause}${noSpeech}`.replace(/\s+/g, ' ').trim()
    })

    const seconds = String(Math.round(clip.seconds * 10) / 10)
    const appearsIn = (label: string) => shots.filter(s => s.focus.some(f => f.label === label)).map(s => s.label).join(', ')
    const sceneClause = clip.opensScene
        ? `The scene begins at ${scene.time.toLowerCase()}.`
        : `The scene continues directly from the previous clip, at the same time and place: everyone is already present and mid-action from the very first frame.${framePicture ? ` The video begins on ${framePicture} and goes on from it without a cut: the camera and the people keep the speed and direction of movement they have in it, nothing pauses or starts over.` : ''}`
    const talking = speakers.length ? ` The characters speak the dialogue themselves, in the shots below.` : ''

    const prompt = [
        'subject_definitions:',
        ...subjects.map(s => s.kind === 'location'
            ? `${s.label} is the ${s.name} environment in ${s.picture}: ${s.description}`.trim()
            : `${s.label} is ${s.name}, the character in ${s.picture}; keep facial identity, build, hair, costume and colors from the picture, but let facial expression follow the action and emotion described in this shot: ${s.description}`.trim()),
        ...(framePicture ? [`${framePicture} is the first frame of [Shot 1], the last frame of the previous clip, showing the scene at the moment that clip ends: ${joinAnd(subjects.map(s => s.label))}.`] : []),
        '',
        'summary:',
        `[reference generation${framePicture ? ' + keyframe completion' : ''}] The target video is ${seconds.startsWith('8') || seconds.startsWith('11') ? 'an' : 'a'} ${seconds}-second clip of a short film${locationSubject ? ` set in ${locationSubject.label}` : ''}${castSubjects.length ? ` with ${joinAnd(castSubjects.map(s => s.label))}` : ''}: ${sceneClause}${talking} It is cut in ${shots.length} shot${shots.length > 1 ? 's' : ''}.`,
        '',
        'retention_analysis:',
        ...subjects.map(s => `${s.label} (appears in ${s.kind === 'location' ? shots.map(x => x.label).join(', ') : appearsIn(s.label) || shots[0]!.label}): fully_preserved - ${s.kind === 'location'
            ? `the layout, materials, colors and lighting of the ${s.name} are retained.`
            : `the facial identity, build, hair and costume of ${s.name} are retained, but expression is free to follow the shot's action.`}`),
        ...(framePicture ? [`${framePicture} ([Shot 1] first frame): fully_preserved - the composition, camera position, lighting and the positions of everyone in it are kept at the start; the action then goes on from it.`] : []),
        '',
        'detailed_description:',
        styleOpening(lookBrief),
        ...(locationSubject ? [`The place stays as it is in ${locationSubject.label}: its features and props keep their place and shape, unless the action below changes them.`] : []),
        ...(stagingText ? [`Staging of the scene, true in every shot unless the action below changes it: ${withLabels(stagingText)}`] : []),
        ...shotTexts,
        '',
        'overall_soundscape:',
        `${withoutSentencesNaming(soundscapes[clip.sceneId] ?? '', unpictured) || `Quiet ambience of the ${location?.name ?? 'scene'}; footsteps, cloth and prop sounds follow the on-screen action.`} ${speakers.length ? (voicesInScene ? 'Apart from the dialogue given in the shots, no words are spoken: voices and whispers described above are indistinct and wordless.' : 'Apart from the dialogue given in the shots, there is no speech, murmuring or voices.') : (voicesInScene ? 'No words are spoken: voices and whispers described above are indistinct and wordless.' : 'There is no speech, murmuring or voices.')}`,
        '',
        'non_diegetic_music:',
        'N/A',
    ].join('\n')

    return {
        id: clip.id,
        index: clip.index,
        sceneId: clip.sceneId,
        seconds: clip.seconds,
        frameStart: clip.frameStart,
        frames: clip.frames,
        ...(clip.startsFrom ? {startsFrom: clip.startsFrom} : {}),
        shots: shots.map(s => ({label: s.label, at: s.at, framing: s.framing, camera: s.camera, subjects: [...(locationSubject ? [locationSubject.label] : []), ...s.focus.map(f => f.label)]})),
        dialogue: shots.flatMap(s => s.spoken.map(l => ({
            at: l.at, line: l.line, speaker: l.character?.name ?? l.key, speakerId: speakerId(l.key),
            ...(l.character && subjectOf(l.character.id) ? {subject: subjectOf(l.character.id)!.label} : {}),
            kind: l.kind, text: l.text,
        }))),
        assets: {
            pictures: [
                ...subjects.map(s => ({label: s.picture, file: 'file' in s && s.file ? s.file : filmPictureAsset(s.kind, s.pictureId), subject: s.label, kind: s.kind, id: s.id, name: s.name, description: s.description})),
                ...(clip.startsFrom ? [{label: framePicture!, file: filmBoundaryFrame(clip.startsFrom), subject: '', kind: 'frame' as const, id: clip.startsFrom, name: `last frame of ${clip.startsFrom}`, description: ''}] : []),
            ],
        },
        prompt,
    }
}

// "a young man's low, hoarse voice, ..." goes after "says in" - a description of the person is made into "the voice of ..."
const voicePhrase = (voice: string) => /\bvoice\b/i.test(voice) ? voice : `the voice of ${voice.charAt(0).toLowerCase()}${voice.slice(1)}`.replace(/\.$/, '')

// the guide: basic punctuation only, every line ends with . ? or !
function normalizeLine(line: string) {
    const clean = line.replace(/\.{2,}|…/g, '.').replace(/[~*]+/g, '').replace(/([!?.,])\1+/g, '$1').trim()
    return /[.?!]$/.test(clean) ? clean : `${clean}.`
}

// The guide wants one or two style sentences before [Shot 1]. Only the first of the look brief: it names the medium and the
// style - the second already describes the world of the whole film, every place in it, and the video model draws what is
// described there into whichever place it is shown (the crystal trees of one location showed up in another)
const styleOpening = (lookBrief: string) => lookBrief.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).slice(0, 1).join(' ')

const joinAnd = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('')
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
