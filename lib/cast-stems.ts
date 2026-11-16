import {type AskOptions, askJson} from './llm.ts'
import {dropPartials} from './partials.ts'
import type {PropStem} from './project.ts'

// The layer of the song a character's instrument is heard in (propStem) is written by the cast step in the same answer as the
// rest of the cast, and a band's player was left without one (tides-of-eternal-flame-261113: a guitarist next to a bassist and
// a drummer with theirs, #1085) - the guitar was then neither analysed nor given to the clips. When part of the cast has a layer,
// the others who carry something are asked once more, by themselves. Whether an object is an instrument is for the language model
// to say; the code only counts who has a layer and who carries something.

export const STEM_NAMES: readonly PropStem[] = ['drums', 'bass', 'other', 'guitar', 'piano']

type Extracted = {name: string; role?: string; prop?: string; propStem?: string}
export type Player = {name: string; role: string; prop: string; propStem: string}
export type Candidate = {name: string; role: string; prop: string}
const hasStem = (c: Extracted) => Boolean(c.prop && c.propStem && (STEM_NAMES as readonly string[]).includes(c.propStem))

/** Who plays an instrument of the song already, and who carries something without a layer - to be asked, when there is a player at all. */
export function stemQuestion(characters: Extracted[]): {players: Player[]; candidates: Candidate[]} {
    const players = characters.filter(hasStem).map(c => ({name: c.name, role: c.role ?? '', prop: c.prop!, propStem: c.propStem!}))
    const candidates = players.length ? characters.filter(c => c.prop && !hasStem(c)).map(c => ({name: c.name, role: c.role ?? '', prop: c.prop!})) : []
    return {players, candidates}
}

/** Those of the candidates who were not asked before (`castLayersAsked` of the project) - the page shows the question only to them. */
export const notAskedYet = <T extends {name: string}>(candidates: T[], asked: string[] | undefined): T[] => candidates.filter(c => !asked?.includes(c.name))

/** The language model's answer to the question: the layer of each who was asked ("" for none). */
export async function askLayers(players: Player[], candidates: Candidate[]): Promise<{name: string; propStem: string}[]> {
    return (await askJson<{layers?: {name: string; propStem: string}[]}>(castStemsPrompt(players, candidates))).layers ?? []
}

export function castStemsPrompt(players: Player[], candidates: Candidate[]): AskOptions {
    return {
        reasoning: 'none',
        maxTokens: 1024,
        instructions: 'You are an expert story editor for music videos. You answer only with JSON.',
        input: `A band performs the song on screen in this music video: whoever plays an instrument in it is heard in the song. These characters play an instrument, with the layer of the song's audio it is heard in:
${JSON.stringify(players)}

These characters carry an object, and no layer is set for it:
${JSON.stringify(candidates)}

For each of them: is the object a musical instrument? A character of the band with an instrument plays it in the song, so every instrument gets its layer: "drums" for a drum kit, "bass" for a bass guitar, "guitar" for any electric or acoustic guitar, "piano" for piano or keys, "other" for anything else melodic (a synth, strings). Only an object that is not a musical instrument at all (a microphone, a sword, a lantern) gets an empty layer.
Answer only with JSON in this format, one entry for each character above, named exactly as above:
{"layers": [{"name": "", "propStem": ""}]}`,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['layers'],
            properties: {
                layers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['name', 'propStem'],
                        properties: {name: {type: 'string'}, propStem: {enum: ['', ...STEM_NAMES]}},
                    },
                },
            },
        },
    }
}

/** The cast with the layers the answer gives to those who were asked - nobody else is touched, and a layer that was set stays. */
export function withStems<T extends Extracted>(characters: T[], layers: {name: string; propStem: string}[], asked: {name: string}[]): T[] {
    const askedNames = new Set(asked.map(a => a.name))
    return characters.map(c => {
        const layer = layers.find(l => l.name === c.name)?.propStem
        return askedNames.has(c.name) && !hasStem(c) && layer && (STEM_NAMES as readonly string[]).includes(layer) ? {...c, propStem: layer} : c
    })
}

/**
 * What goes when a layer is given to a character of a planned project: the separated instruments and the activity read from the
 * layers, and the shot plans built on the activity. The looks, the beats, the timeline and the places stay - the layer is no part of
 * how a character looks, and the language model need not tell the story again.
 */
export const DROPPED_BY_LAYERS = ['instrumentStems', 'propActivity', 'shotMoments', 'shotViews']

/** Gives the layers an answer names to those who were asked, in the cast of a planned project (#1085), and drops what is built on them. */
export function giveLayers(
    data: {cast?: {characters: (Extracted & {id: string})[]}} & Record<string, unknown>,
    asked: {name: string}[],
    layers: {name: string; propStem: string}[],
): {given: {id: string; name: string; propStem: string}[]; dropped: string[]} {
    if (!data.cast) return {given: [], dropped: []}
    const before = data.cast.characters
    const after = withStems(before, layers, asked)
    const given = after.flatMap((c, i) => (c.propStem && c.propStem !== before[i]!.propStem ? [{id: c.id, name: c.name, propStem: c.propStem}] : []))
    if (!given.length) return {given: [], dropped: []}
    data.cast.characters = after
    const dropped = DROPPED_BY_LAYERS.filter(step => step in data)
    for (const step of dropped) {
        delete data[step]
        dropPartials(data as Parameters<typeof dropPartials>[0], step)
    }
    return {given, dropped}
}
