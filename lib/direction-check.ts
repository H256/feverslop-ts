// A body that leans, presses or steps "forward" says nothing about the lens: the video model moves it toward the camera.
// tides-261115 slot-028: the singer on a stage seen over a crowd "presses her weight forward" - drawn walking off the stage
// into the crowd, big in front of the camera. The shot planner is told to say toward whom or what (lib/shot-planner.ts, the
// rule of walking), and in a replan of the whole song it still wrote "presses her body fully forward" in five shots in a row.
// What the entries say is read here by the language model, nothing decided from words; an unclear direction is asked again.

import {askJson, type AskOptions} from './llm.ts'
import type {Character, ShotPlan} from './project.ts'
import type {Issue} from './shot-plan.ts'

export type DirectionCase = {shot: number; view: string; people: {name: string; state: string; frame: string; motion: string}[]}

/** Every shot with somebody who is said to stand or move somewhere: the camera and each one's words. */
export function directionCases(shots: ShotPlan[], characters: Pick<Character, 'id' | 'name'>[]): DirectionCase[] {
    return shots.flatMap((shot, j) => {
        const people = Object.entries(shot.people ?? {}).flatMap(([id, p]) => {
            const name = characters.find(c => c.id === id)?.name
            return name && (p.state || p.motion) ? [{name, state: p.state ?? '', frame: p.frame ?? '', motion: p.motion ?? ''}] : []
        })
        const view = [shot.view, shot.camera].filter(Boolean).join('; ')
        return people.length ? [{shot: j, view, people}] : []
    })
}

/** One call for all cases of a beat, thinking low like the check of the places in the picture (lib/placement-check.ts). */
export async function directionIssues(cases: DirectionCase[], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<Issue[]> {
    if (!cases.length) return []
    const answer = await ask<{shots?: {unclear?: unknown; who?: unknown; why?: unknown}[]}>({
        maxTokens: 6144 + cases.length * 80,
        reasoning: 'low',
        input: `Each entry below is one shot of a music video: where the camera is ("view") and, for each person in the picture, where they stand ("state"), where they are in the picture ("frame") and how they move ("motion"). A video model reads every direction as the camera sees it.
unclear true when somebody's whole body or torso leans, presses, sways, rocks, steps or moves in a direction told only by their own body - forward, ahead, back - without saying toward whom or what, and the camera does not see them from the side. The model then moves them toward the lens or away from it: a singer on a stage seen over a crowd who "presses her weight forward" was drawn walking off the stage into the crowd, big in front of the camera.
unclear false when the direction names whom or what it goes toward (toward the drummer, into the light, over the edge of the stage), when it is given as the camera sees it (toward the camera, across the frame), when only hair, head, hands or arms move, when a player only rocks or leans with each stroke, chord or hit and stays where they are, or when the words do not say enough to tell.
"who": the name of that person ("" when nobody). "why": the words of theirs that give no target ("" when nobody).
Answer only with JSON: {"shots": [{"unclear": true or false, "who": "...", "why": "..."} per entry, in order]} - exactly ${cases.length} entries.
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
                        required: ['unclear', 'who', 'why'],
                        properties: {unclear: {type: 'boolean'}, who: {type: 'string'}, why: {type: 'string'}},
                    },
                },
            },
        },
    })
    return cases.flatMap((c, n) => {
        const a = answer.shots?.[n]
        if (a?.unclear !== true) return []
        const who = typeof a.who === 'string' && a.who.trim() ? a.who.trim() : 'somebody'
        const why = typeof a.why === 'string' && a.why.trim() ? ` ("${a.why.trim().replace(/[.\s]+$/, '')}")` : ''
        return [
            {
                shot: c.shot,
                message: `shot ${c.shot + 1}: ${who} leans, presses or steps without a target${why} - the video model then moves them toward the camera: say toward whom or what (toward the drummer, into the light, over the edge of the stage), or as this camera sees it`,
            },
        ]
    })
}
