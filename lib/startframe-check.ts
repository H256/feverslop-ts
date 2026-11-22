// Everybody exactly once in a start picture (#1187): MiniMax H3-Image drew Sera twice in a wide shot of tides-261115 slot-033
// although the prompt says "each exactly once", and a person drawn twice in the picture is drawn twice in the whole shot. The
// picture is read by the vision model next to each person's own reference picture - it counts, nothing is decided from words.

import {askJson, type AskOptions} from './llm.ts'

export type PersonCount = {id: string; name: string; count: number}

/**
 * How often each person is in the picture, read by the vision model: the picture first, then one reference picture per person,
 * all as data URLs (visionUrls). One call, the counts in the order of the people.
 */
export async function countPeople(
    picture: string,
    people: {id: string; name: string; reference: string}[],
    ask: <T>(options: AskOptions) => Promise<T> = askJson,
): Promise<PersonCount[]> {
    if (!people.length) return []
    // the model names every figure it sees, the code counts: asked for counts, it said 1 for a bassist drawn twice
    const answer = await ask<{figures?: unknown[]}>({
        maxTokens: 4096,
        images: [picture, ...people.map(p => p.reference)],
        input: `The first image is one picture of a music video. Each image after it shows one person, in this order: ${people.map((p, n) => `image ${n + 2} ${p.name}`).join(', ')}.
Go through the first image from left to right and list every figure in it that is not part of a crowd or audience: for each one, the name of the person it looks like (face, hair, build, costume, what they hold), or "other" when it is none of them. Two figures that look like the same person are both listed with that name - a person can be drawn twice.
Answer only with JSON: {"figures": ["name", ...]} - one entry per figure, left to right.`,
        instructions: 'You check pictures of a music video for who is in them. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['figures'],
            properties: {figures: {type: 'array', items: {type: 'string', enum: [...people.map(p => p.name), 'other']}}},
        },
    })
    const figures = (answer.figures ?? []).map(String)
    return people.map(p => ({id: p.id, name: p.name, count: figures.filter(f => f === p.name).length}))
}

/** The people who are not exactly once in the picture, said for the log. */
export const notOnce = (counts: PersonCount[]) => counts.filter(c => c.count !== 1)
export const describeCounts = (wrong: PersonCount[]) =>
    wrong.map(c => (c.count === 0 ? `${c.name} is missing` : `${c.name} is in it ${c.count} times`)).join(', ')
