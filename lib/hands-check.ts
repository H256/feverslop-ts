// A person whose hands do two things at once - the instrument in one hand, the other on a friend's shoulder - is drawn
// twice by the video model, once for each (stille-im-spiegel 037: Julian at the piano with his hand on Elias' shoulder,
// and Julian again at the side with his guitar), or with a third hand. The shot planner is told so (lib/shot-planner.ts,
// "Their hands do one thing at a time") and still wrote "left hand on Elias' shoulder, guitar in right hand". What the
// entries say is read here by the language model, nothing decided from words; a case answered "yes" is asked again.

import {askJson, type AskOptions} from './llm.ts'
import type {Character, ShotPlan} from './project.ts'
import type {Issue} from './shot-plan.ts'

export type HandsCase = {shot: number; name: string; prop: string; text: string}

/** Every person of the shots who carries their prop (not one that stands in a place), with all their entry says. */
export function handsCases(shots: ShotPlan[], characters: Pick<Character, 'id' | 'name' | 'prop' | 'propCarried'>[]): HandsCase[] {
    return shots.flatMap((shot, j) =>
        Object.entries(shot.people ?? {}).flatMap(([id, p]) => {
            const c = characters.find(c => c.id === id)
            if (!c?.prop || c.propCarried === false) return []
            const text = [p.state, p.motion, p.plays].filter(Boolean).join('; ')
            return text ? [{shot: j, name: c.name, prop: c.prop, text}] : []
        }),
    )
}

/** One call for all cases of a beat, thinking off. A call that fails costs only this check. */
export async function handsIssues(cases: HandsCase[], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<Issue[]> {
    if (!cases.length) return []
    const answer = await ask<{twice?: unknown[]}>({
        maxTokens: 512 + cases.length * 16,
        reasoning: 'none',
        input: `Each entry below is one person in one shot of a music video: their "prop" and what the shot says they do ("text"). Do their hands do two things at once - the prop held or played with one hand while the other hand touches, holds, takes or points at someone or something else?
true only then: one hand on the prop, the other on a person, a thing or in a gesture.
false when both hands are on the prop, when the prop hangs on its strap, is slung on the back, sheathed or set down while the hands do something else, or when the text does not say where the hands are.
Answer only with JSON: {"twice": [true or false per entry, in order]} - exactly ${cases.length} values.
---
${JSON.stringify(cases.map(c => ({person: c.name, prop: c.prop, text: c.text})))}`,
        instructions: 'You check music video shot descriptions for what a video model cannot draw. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['twice'],
            properties: {twice: {type: 'array', minItems: cases.length, maxItems: cases.length, items: {type: 'boolean'}}},
        },
    })
    return cases.flatMap((c, n) =>
        answer.twice?.[n] === true
            ? [
                  {
                      shot: c.shot,
                      message: `shot ${c.shot + 1}: ${c.name} holds the ${c.prop} in one hand while the other does something else ("${c.text}") - the video model draws ${c.name} twice: either both hands on the ${c.prop}, or the ${c.prop} hung on its strap, slung on the back or set down while the hands do the other thing`,
                  },
              ]
            : [],
    )
}
