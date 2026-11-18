// A shot of a crowd together with the band is seen over the crowd's heads toward the stage (lib/shot-planner.ts, the rule of
// the place's "set"): seen from the side, from "among the audience" or only "from the door wall", the video model drew the
// crowd on the stage around the band - identical faces, the singer lost (tides-261115, slots 028 and 040). The rule alone was
// not kept, so the view of such a shot is read here by the language model, nothing decided from words; a "no" is asked again.

import {askJson, type AskOptions} from './llm.ts'
import type {Character, LocationSet, ShotPlan} from './project.ts'
import type {Issue} from './shot-plan.ts'

export type CrowdViewCase = {shot: number; crowd: string; band: string[]; view: string}

/** Every shot that shows a crowd with a fixed place in the set together with somebody who plays, with its camera words. */
export function crowdViewCases(
    shots: ShotPlan[],
    characters: Pick<Character, 'id' | 'name' | 'isGroup' | 'prop'>[],
    set: LocationSet | undefined,
): CrowdViewCase[] {
    if (!set) return []
    return shots.flatMap((shot, j) => {
        const ids = shot.characters ?? []
        const crowd = characters.find(c => c.isGroup && ids.includes(c.id) && set.spots[c.id])
        const band = characters.filter(c => !c.isGroup && c.prop && ids.includes(c.id)).map(c => c.name)
        const view = [shot.view, shot.camera].filter(Boolean).join('; ')
        return crowd && band.length && view ? [{shot: j, crowd: crowd.name, band, view}] : []
    })
}

/** One call for all cases of a beat, thinking off. A call that fails costs only this check. */
export async function crowdViewIssues(cases: CrowdViewCase[], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<Issue[]> {
    if (!cases.length) return []
    const answer = await ask<{over?: unknown[]}>({
        maxTokens: 512 + cases.length * 16,
        reasoning: 'none',
        input: `Each entry below is one shot of a music video that shows a crowd ("crowd") and the band on the stage ("band"), with where the camera is ("view"). Does the camera stand behind the crowd, or at its back, and look over the crowd's heads toward the band - so the crowd is between the camera and the stage?
true only then.
false when the camera is among the crowd, at the side, on the stage, in front of the band, or when the view does not say where the crowd is in the picture.
Answer only with JSON: {"over": [true or false per entry, in order]} - exactly ${cases.length} values.
---
${JSON.stringify(cases.map(c => ({crowd: c.crowd, band: c.band.join(', '), view: c.view})))}`,
        instructions: 'You check music video shot descriptions for what a video model cannot draw. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['over'],
            properties: {over: {type: 'array', minItems: cases.length, maxItems: cases.length, items: {type: 'boolean'}}},
        },
    })
    return cases.flatMap((c, n) =>
        answer.over?.[n] === false
            ? [
                  {
                      shot: c.shot,
                      message: `shot ${c.shot + 1}: ${c.crowd} and the band are in it, but the camera ("${c.view}") does not look over ${c.crowd}'s heads - the video model then draws ${c.crowd} on the stage around the band: a "view" from behind ${c.crowd}, over their heads toward the stage, ${c.crowd} in front, or a shot without ${c.crowd}`,
                  },
              ]
            : [],
    )
}
