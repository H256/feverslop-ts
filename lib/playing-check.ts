// Whose instrument is heard in a shot writes in "playing:" what the hands do on it (lib/shot-plan.ts) - that a phrase is
// there is counted, what it says is read here: a beat that tells a frozen tableau ("holds a trembling chord") got
// "drumsticks held rigid" and "pick hand frozen over strings" while the music plays on. Read by the language model,
// nothing decided from words.

import {askJson, type AskOptions} from "./llm.ts";
import type {Character, ShotPlan} from "./project.ts";
import type {Issue, ShotProps} from "./shot-plan.ts";

export type PlayingCase = { shot: number, name: string, prop: string, plays: string, motion?: string }

/** Every heard player of the shots with their phrase - a player without one is already a problem of the plan itself. */
export function playingCases(shots: ShotPlan[], props: ShotProps | undefined, characters: Pick<Character, 'id' | 'name'>[]): PlayingCase[] {
    if (!props?.length) return []
    return shots.flatMap((shot, j) => Object.entries(shot.people ?? {}).flatMap(([id, p]) => {
        const instrument = props.find(e => e.characterId === id)
        if (!instrument?.activePerShot[j] || !p.playing || !p.plays) return []
        const name = characters.find(c => c.id === id)?.name ?? id
        return [{shot: j, name, prop: instrument.prop, plays: p.plays, ...(p.motion ? {motion: p.motion} : {})}]
    }))
}

/**
 * One call for all cases of a beat, thinking off - it only reads short phrases. A case answered "no" is a problem of its
 * shot (asked again with the beat's other problems). A call that fails costs only this check.
 */
export async function playingIssues(cases: PlayingCase[], ask: <T>(options: AskOptions) => Promise<T> = askJson): Promise<Issue[]> {
    if (!cases.length) return []
    const answer = await ask<{ playing?: unknown[] }>({
        maxTokens: 512 + cases.length * 16,
        reasoning: 'none',
        input: `In each entry below, the person's instrument is heard in the music through the whole shot. "hands" is what the person's hands do in the shot, "body" what the rest of the body does. Does the entry show the person playing the instrument - the hands making it sound?
true whenever the hands make it sound in any way: soft or loud, simple or wild, a light tap, a roll, a fill, a muted or picked note, a held chord that is struck, with the body doing whatever else.
false only when the hands do not make it sound: they are still or frozen, rest on it or hover over it, only hold or grip it, damp or silence it, are lifted or taken away from it, or the body sets the instrument aside - also when only one of "hands" and "body" says so.
Answer only with JSON: {"playing": [true or false per entry, in order]} - exactly ${cases.length} values.
---
${JSON.stringify(cases.map(c => ({person: c.name, instrument: c.prop, hands: c.plays, ...(c.motion ? {body: c.motion} : {})})))}`,
        instructions: 'You check music video shot descriptions against the music. Answer only with JSON.',
        schema: {type: 'object', additionalProperties: false, required: ['playing'], properties: {playing: {type: 'array', minItems: cases.length, maxItems: cases.length, items: {type: 'boolean'}}}},
    })
    return cases.flatMap((c, n) => answer.playing?.[n] === false ? [{
        shot: c.shot,
        message: `shot ${c.shot + 1}: ${c.name}'s ${c.prop} is heard through this shot, but "${c.plays}"${c.motion ? ` with "${c.motion}"` : ''} does not play it - playing: what ${c.name}'s hands do to play the ${c.prop} all through the shot, and a motion that keeps them on it`,
    }] : [])
}
