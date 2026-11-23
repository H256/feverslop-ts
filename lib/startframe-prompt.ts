// The start picture of a shot (#1187): the blocking a video model keeps getting wrong when it is only told - who stands where,
// who faces which way, a crowd with the band far beyond it - drawn once as a still by MiniMax H3-Image from the clip's own
// reference pictures, and pinned at the shot's first frame of the clip (MiniMaxH3AddGuide). tides-261115 slot-028: told,
// the singer stood among the crowd in 3 renders of 3; with a start picture per shot, 3 of 3 held.
//
// The words come from the shot plan the clip is made of (its view, size and each person's state, place in the picture and
// singing), put in the order the picture model reads best: the frame first, then the people, then the details. Only the
// reference pictures this shot needs go in - MiniMaxH3ImageConditioning brings every picture to a 1024 px short edge for its
// text encoder, so each one costs a megapixel or more of tokens.

import type {ClipRequest} from './compose.ts'
import type {Character, LocationSet, ShotPlan} from './project.ts'
import {replaceTokens} from './refs.ts'

/** A reference picture of a start picture: which picture of the clip it is and what the prompt calls it. */
// small: a person small in a wide shot - the front view alone does (lib/render/startframes.ts)
// name, group: a person's, for the check that everybody is in the picture once (lib/startframe-check.ts) - a crowd is not counted
// where, hidden, sings: where the plan puts them in the picture, whether their face is out of view and whether they sing, for the
// head pass (lib/startframe-faces.ts)
export type StartPicture = {
    kind: 'location' | 'character' | 'prop'
    id: string
    file: string
    label: string
    small?: true
    name?: string
    group?: true
    where?: string
    hidden?: true
    sings?: true
}
// lighter: the same shot without its prop pictures, drawn when the text encoder runs out of memory on this one (lib/render/startframes.ts)
export type StartFrameRequest = {
    clip: string
    shot: number
    at: number
    prompt: string
    pictures: StartPicture[]
    megapixels: number
    lighter?: Omit<StartFrameRequest, 'lighter'>
}

type Shot = ClipRequest['shots'][number] & {plan?: ShotPlan}
type Input = {
    clip: Pick<ClipRequest, 'id' | 'shots' | 'assets'>
    characters: Pick<Character, 'id' | 'name' | 'isGroup' | 'prop' | 'propCarried'>[]
    look: string // the look of the video, one line
    set?: LocationSet // the fixed places of the clip's place, by name (placeOf)
    // what a reference picture costs the text encoder, in megapixels after its 1024 px short edge (lib/render/startframes.ts)
    megapixels?: (picture: Omit<StartPicture, 'label'>) => number
}

/**
 * The reference pictures a start picture may take, in megapixels as the text encoder sees them. On the 32 GB Radeon six of them
 * (a place, three people as 2x2 grids, two props: about 9.6 MP) went through; a place, four grids and a sheet (12 MP) and nine
 * pictures (about 15 MP) ran out of memory in MiniMaxH3ImageConditioning. Over it, the props go first: they are drawn from their
 * words then, like without propPictures. A shot that is over it with its people alone is said (lib/render/startframes.ts).
 */
export const START_PICTURE_MEGAPIXELS = 10
// without a measure: a place frame and a turnaround grid or sheet as they are scaled, a prop as its middle square (startReference)
const roughly = (picture: Omit<StartPicture, 'label'>) => (picture.kind === 'prop' ? 1 : 1.9)

const label = (n: number) => `<Picture ${n}>`
const clean = (text: string | undefined) => text?.trim().replace(/[.\s]+$/, '') ?? ''

/** The start pictures of a clip: one per shot that has a plan with somebody in it. */
export function startFrameRequests(input: Input): StartFrameRequest[] {
    return (input.clip.shots as Shot[]).flatMap((shot, n) => {
        const request = startFrameOf(input, shot, n)
        return request ? [request] : []
    })
}

function startFrameOf(input: Input, shot: Shot, n: number): StartFrameRequest | undefined {
    const request = drawnFrom(input, shot, n, true)
    const lighter = request?.pictures.some(p => p.kind === 'prop') ? drawnFrom(input, shot, n, false) : undefined
    return request && lighter ? {...request, lighter} : request
}

// withProps false: the props are drawn from their words, as when none fits the budget
function drawnFrom(input: Input, shot: Shot, n: number, withProps: boolean): Omit<StartFrameRequest, 'lighter'> | undefined {
    const plan = shot.plan
    const ids = plan?.characters?.length ? plan.characters : []
    if (!plan || !ids.length) return undefined
    const all = input.clip.assets.pictures
    const location = all.find(p => p.kind === 'location')
    const cast = ids.flatMap(id => {
        const character = input.characters.find(c => c.id === id)
        const picture = all.find(p => p.kind === 'character' && p.id === id)
        return character && picture ? [{character, picture}] : []
    })
    if (!cast.length) return undefined
    // a prop goes with whoever has it in the shot: its picture is the one named like the character's prop
    // an instrument that stands in the place (a drum kit) first: it is the biggest of them in the picture, and drawn from its words
    // it came out a plain red kit instead of the coral one in the wide shots of slot-033, where only one prop fitted the budget
    const props = cast
        .flatMap(({character}) => {
            const picture = character.prop ? all.find(p => p.kind === 'prop' && p.name === character.prop) : undefined
            return picture ? [{owner: character.id, picture, standing: character.propCarried === false}] : []
        })
        .sort((a, b) => Number(b.standing) - Number(a.standing))
    // in a wide shot everybody is small: the front view is enough, and with the whole band and a crowd the grids are too much
    const small = plan.size === 'wide'
    // over the budget the last props are left out, until it fits or none is left
    const cost = input.megapixels ?? roughly
    const of = (kind: StartPicture['kind'], p: {id: string; file: string}) =>
        cost({kind, id: p.id, file: p.file, ...(small && kind === 'character' ? {small: true as const} : {})})
    let total = (location ? of('location', location) : 0) + cast.reduce((sum, c) => sum + of('character', c.picture), 0)
    const taken = props.filter(prop => {
        if (!withProps) return false
        const more = of('prop', prop.picture)
        if (total + more > START_PICTURE_MEGAPIXELS) return false
        total += more
        return true
    })
    const words = (text: string | undefined) => clean(text && replaceTokens(text, input.characters as Character[], c => c.name))
    const pictures: StartPicture[] = []
    const add = (kind: StartPicture['kind'], id: string, file: string, who?: Pick<StartPicture, 'name' | 'group' | 'where' | 'hidden' | 'sings'>) => {
        pictures.push({kind, id, file, label: label(pictures.length + 1), ...(small && kind === 'character' ? {small: true as const} : {}), ...who})
        return pictures.at(-1)!.label
    }
    const place = location ? add('location', location.id, location.file) : undefined
    const personLabel = new Map(
        cast.map(({character, picture}) => [
            character.id,
            add('character', character.id, picture.file, {
                name: character.name,
                ...(character.isGroup ? {group: true as const} : {}),
                ...(plan.people?.[character.id]?.frame ? {where: words(plan.people[character.id]!.frame)} : {}),
                ...(plan.people?.[character.id]?.faceHidden ? {hidden: true as const} : {}),
                ...(plan.people?.[character.id]?.singing ? {sings: true as const} : {}),
            }),
        ]),
    )
    const propLabel = new Map(taken.map(({owner, picture}) => [owner, add('prop', picture.id, picture.file)]))

    const singing = new Set(Object.entries(plan.people ?? {}).flatMap(([id, p]) => (p.singing ? [id] : [])))
    const crowd = cast.find(({character}) => character.isGroup)?.character
    const band = cast.filter(({character}) => !character.isGroup && (character.prop || singing.has(character.id)))

    const person = ({character}: (typeof cast)[number]) => {
        const p = plan.people?.[character.id] ?? {}
        const own = personLabel.get(character.id)!
        const who = character.isGroup
            ? `${character.name}: a crowd of different people - ${own} shows one of them; every other one has a face, hair and build of their own, in the same style of clothing`
            : `${character.name}, the person of ${own}`
        const prop = propLabel.get(character.id)
        const of = prop ? ` of ${prop}` : ''
        const holds = character.prop ? (character.propCarried === false ? `, at the ${character.prop}${of}` : `, with the ${character.prop}${of}`) : ''
        const mouth = character.isGroup ? '' : singing.has(character.id) ? '; singing, mouth open' : '; mouth closed'
        const parts = [words(p.state), p.frame ? `in the picture: ${words(p.frame)}` : ''].filter(Boolean)
        return `- ${who}${holds}${parts.length ? `: ${parts.join('; ')}` : ''}${mouth}.`
    }

    const camera = [words(plan.view), words(shot.framing || plan.framing)].filter(Boolean).join('; ')
    const fixed = input.set
        ? Object.entries(input.set.spots)
              .filter(([name]) => cast.some(({character}) => character.name === name))
              .map(([name, spot]) => `${name}: ${clean(spot)}`)
        : []
    const depth =
        crowd && band.length
            ? `${crowd.name} are nearest to the camera with their backs to it, facing the band; far beyond them, small on the stage, ${band.map(({character}) => character.name).join(', ')} - nobody of the band is among ${crowd.name} or near the camera.`
            : ''
    const lines = [
        // the look names the medium (live action, anime, stop-motion, ...) - the picture takes it literally and adds no
        // medium or polish of its own: a style picked at random need not be realistic, nor cinematic
        input.look
            ? `One frame of the film itself, 16:9, made in exactly the medium and look it is filmed in: ${clean(input.look)}. Nothing more painted, polished or dramatic than that look says.`
            : 'One frame of the film itself, 16:9.',
        place ? `The place is ${location!.name} of ${place}, kept as it is there: ${clean(location!.description)}.` : '',
        input.set?.stage ? `The stage: ${clean(input.set.stage)}.${fixed.length ? ` Fixed places: ${fixed.join('; ')}.` : ''}` : '',
        camera ? `The camera: ${camera}.` : '',
        `In the picture, each exactly once${crowd ? '' : ', nobody else'}:`,
        ...cast.map(person),
        depth,
        `Everyone keeps the face, hair, build and clothing of their picture; nothing of the plain backdrop or the sheet layout of those pictures is in the image.`,
    ]
    return {clip: input.clip.id, shot: n, at: shot.at, prompt: lines.filter(Boolean).join('\n'), pictures, megapixels: Math.round(total * 100) / 100}
}
