// Where somebody stands ("state": "between Maren and Kael") and where they are in the picture ("frame": "right of centre")
// have to fit together for everybody in a shot. tides-261115 slot-014: Maren in the centre, Kael "left of centre", Sera
// "between them" but "right of centre" - the video model drew a second Kael on the right, left Sera out, and the second
// Kael kept her bass in the next shot. The shot planner is told so (lib/shot-planner.ts, the rule of "people"); what the
// entries say is read here by the language model, nothing decided from words; a clash is asked again.

import {askJson, type AskOptions} from './llm.ts'
import type {Character, ShotPlan} from './project.ts'
import type {Issue} from './shot-plan.ts'

export type PlacementCase = {shot: number; view: string; people: {name: string; state: string; frame: string}[]}

/** Every shot with three or more people who have an entry with a place in the picture: the camera and each one's words. */
export function placementCases(shots: ShotPlan[], characters: Pick<Character, 'id' | 'name'>[]): PlacementCase[] {
    return shots.flatMap((shot, j) => {
        const people = Object.entries(shot.people ?? {}).flatMap(([id, p]) => {
            const name = characters.find(c => c.id === id)?.name
            return name && p.frame ? [{name, state: p.state ?? '', frame: p.frame}] : []
        })
        const view = [shot.view, shot.camera].filter(Boolean).join('; ')
        return people.length >= 3 ? [{shot: j, view, people}] : []
    })
}

/**
 * One call for all cases of a beat, thinking low: without it, Sera left of centre between Maren in the centre and Kael further
 * left was answered as a clash (tides-261115, 19 of 61 shots flagged, several wrongly; with it 4 of 30, each a real one).
 * A call that fails costs only this check.
 */
export async function placementIssues(cases: PlacementCase[], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<Issue[]> {
    if (!cases.length) return []
    const answer = await ask<{shots?: {clash?: unknown; why?: unknown}[]}>({
        maxTokens: 6144 + cases.length * 80,
        reasoning: 'low',
        input: `Each entry below is one shot of a music video: where the camera is ("view") and, for each person in the picture, where they stand ("state") and where they are in the picture ("frame"). Can all of them be true at once in this one picture?
clash true only when they cannot: someone said to stand between two others is not between them in the picture (both of the others on one side of them), two people are in the same spot, or someone is said to be beside, in front of or behind a person whose place in the picture makes that impossible.
clash false when it all fits, or when the words do not say enough to tell. "To her left" and "to his right" are the person's own left and right, which the camera may see the other way round - that alone is no clash.
"why": one short sentence naming who and what does not fit ("" when there is no clash).
Answer only with JSON: {"shots": [{"clash": true or false, "why": "..."} per entry, in order]} - exactly ${cases.length} entries.
---
${JSON.stringify(cases.map(c => ({view: c.view, people: c.people})))}`,
        instructions: 'You check music video shot descriptions for what a video model cannot draw. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['shots'],
            properties: {
                shots: {
                    type: 'array',
                    minItems: cases.length,
                    maxItems: cases.length,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['clash', 'why'],
                        properties: {clash: {type: 'boolean'}, why: {type: 'string'}},
                    },
                },
            },
        },
    })
    return cases.flatMap((c, n) => {
        const a = answer.shots?.[n]
        if (a?.clash !== true) return []
        const why = typeof a.why === 'string' && a.why.trim() ? ` (${a.why.trim().replace(/[.\s]+$/, '')})` : ''
        return [
            {
                shot: c.shot,
                message: `shot ${c.shot + 1}: where the people stand and where they are in the picture do not fit together${why} - the video model then draws one of them twice and leaves another out: give everybody a place in the picture ("frame") that fits who stands between, beside or behind whom in "state", as this camera sees them`,
            },
        ]
    })
}
