import {type AskOptions, askJson} from './llm.ts'

// Whether a character carries their prop while using it or goes to where it stands (propCarried) is written by the cast step in the
// same long answer as the rest of the cast - and zz-stille-261118 got a drum kit and a piano player's "keys" as carried, although the
// rule names a drum kit as the example of one that stands. The clips then put the "keys in his hands" and drew the piano player
// at the back of the piano. Every character with a prop is asked once more, by this question alone; its answer wins. Whether an
// object is carried is for the language model to say; the code only takes its answer over.

type Extracted = {name: string; role?: string; prop?: string; propCarried?: boolean; propInHand?: string; propPlace?: string}
export type Holder = {name: string; role: string; prop: string}
export type Standing = {name: string; carried: boolean; inHand: string; place: string}

/** Everybody with a prop - to be asked. */
export const holdersOf = (characters: Extracted[]): Holder[] =>
    characters.filter(c => c.prop?.trim()).map(c => ({name: c.name, role: c.role ?? '', prop: c.prop!}))

/** The language model's answer: for each who was asked, whether they carry it, what is in their hands at it and where it stands. */
export async function askStanding(holders: Holder[], locations: string[]): Promise<Standing[]> {
    return (await askJson<{props?: Standing[]}>(castStandingPrompt(holders, locations))).props ?? []
}

export function castStandingPrompt(holders: Holder[], locations: string[]): AskOptions {
    return {
        reasoning: 'none',
        maxTokens: 512 + holders.length * 64,
        instructions: 'You are an expert story editor for music videos and films. You answer only with JSON.',
        input: `These characters each use one object in the story:
${JSON.stringify(holders)}

The places of the story: ${JSON.stringify(locations)}

For each of them: does the character have the object on them while using it - held in the hands, on a strap, worn, on the back or at the belt - or is it too big or too fixed to be carried, so that it stands somewhere and the character goes to it to use it (a drum kit, a piano or a keyboard on its stand, an organ, an anvil, a loom)?
- "carried": true for an object on them while it is used, false for one that stands.
- "inHand": only for one that stands - what the character holds while using it (drumsticks, a smith's hammer), or "" when they use it with nothing in their grip (the keys of a piano are played with bare hands). "" for a carried one.
- "place": only for one that stands - the place above, exactly as written, where it stands; "" when it stands in more than one of them, and "" for a carried one.
Answer only with JSON in this format, one entry for each character above, named exactly as above:
{"props": [{"name": "", "carried": true, "inHand": "", "place": ""}]}`,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['props'],
            properties: {
                props: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['name', 'carried', 'inHand', 'place'],
                        properties: {name: {type: 'string'}, carried: {type: 'boolean'}, inHand: {type: 'string'}, place: {type: 'string'}},
                    },
                },
            },
        },
    }
}

/**
 * The cast with the answer taken over for everybody it names: a carried prop loses what only a standing one has, a standing one gets
 * what is in the hands and its place. Who the answer leaves out keeps what the cast step said.
 */
export function withStanding<T extends Extracted>(characters: T[], answers: Standing[]): T[] {
    return characters.map(c => {
        const a = c.prop ? answers.find(s => s.name === c.name) : undefined
        if (!a) return c
        const {propInHand: _inHand, propPlace: _place, ...rest} = c
        if (a.carried) return {...rest, propCarried: true} as T
        return {
            ...rest,
            propCarried: false,
            ...(a.inHand.trim() ? {propInHand: a.inHand.trim()} : {}),
            ...(a.place.trim() ? {propPlace: a.place.trim()} : {}),
        } as T
    })
}
