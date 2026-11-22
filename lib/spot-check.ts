// A player who carries the instrument and a singer have a place of their own on the stage (the place's "set", lib/prompts.ts):
// without one, Sera and Maren were both "in the centre of the stage" in tides-261115 slot-033, and every start picture of its
// shots put them elsewhere - a jump at each cut. The planner is told to keep them there (lib/shot-planner.ts); whether a shot's
// words put somebody at another place is read here by the language model, nothing decided from words. A "no" is asked again.

import {askJson, type AskOptions} from './llm.ts'
import type {Character, LocationSet, ShotPlan} from './project.ts'
import type {Issue} from './shot-plan.ts'

export type SpotCase = {shot: number; name: string; spot: string; state: string}

/** Every person in a shot who moves freely on the stage and has a spot in the set, with what the shot says of them. */
export function spotCases(
    shots: ShotPlan[],
    characters: Pick<Character, 'id' | 'name' | 'isGroup' | 'propCarried'>[],
    set: LocationSet | undefined,
): SpotCase[] {
    if (!set) return []
    // a standing instrument and a crowd are kept at theirs by their own rules (the set's rule, lib/crowd-view-check.ts)
    const free = characters.filter(c => !c.isGroup && c.propCarried !== false && set.spots[c.id])
    return shots.flatMap((shot, j) =>
        free.flatMap(c => {
            const state = shot.people?.[c.id]?.state?.trim()
            return state && shot.characters?.includes(c.id) ? [{shot: j, name: c.name, spot: set.spots[c.id]!, state}] : []
        }),
    )
}

/** One call for all cases of a beat, thinking off. A call that fails costs only this check. */
export async function spotIssues(cases: SpotCase[], moments: string[] = [], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<Issue[]> {
    if (!cases.length) return []
    const answer = await ask<{kept?: unknown[]}>({
        maxTokens: 512 + cases.length * 16,
        reasoning: 'none',
        input: `Each entry below is one person in one shot of a music video: their fixed place on the stage ("spot") and what the shot says of them ("state"). Does the state keep them at their spot?
true when the state puts them at their spot, or names no place at all, or has them go somewhere a moment of the scene below takes them.
false when the state puts them at another place on the stage or in the place than their spot - another side, the centre when their spot is a side, another feature.
Answer only with JSON: {"kept": [true or false per entry, in order]} - exactly ${cases.length} values.
${moments.length ? `Moments of the scene:\n${moments.map(m => `- ${m}`).join('\n')}\n` : ''}---
${JSON.stringify(cases.map(c => ({person: c.name, spot: c.spot, state: c.state})))}`,
        instructions: 'You check music video shot descriptions for continuity of where people stand. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['kept'],
            properties: {kept: {type: 'array', minItems: cases.length, maxItems: cases.length, items: {type: 'boolean'}}},
        },
    })
    return cases.flatMap((c, n) =>
        answer.kept?.[n] === false
            ? [
                  {
                      shot: c.shot,
                      message: `shot ${c.shot + 1}: ${c.name} is put elsewhere ("${c.state}") than their place on the stage ("${c.spot}") - every cut then shows them somewhere else: keep ${c.name} at their place, or a moment of the beat that moves them there`,
                  },
              ]
            : [],
    )
}
