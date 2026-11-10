import type {AskOptions} from '../llm.ts'

export const directionInstructions = `You are editing an existing shot plan, not writing a new story.
Interpret the director's verbatim instructions as changes to performance and camera. Replace contradictory incidental motion in the old shot; keep compatible details. Preserve story outcomes, identities, appearance, props, audio, dialogue, timing, shot count and duration.

Each selected shot lists ruleIds: apply only those rules to it. Specificity is shot > scene/beat/time > character > global. A character filter narrows a scope further. More specific intent wins only where contradictory; compatible rules combine. Report contradictory equally specific rules in conflicts rather than guessing which to keep.

For 'occasionally' or 'in some scenes', choose a suitable subset of the selected shots. Return the actual chosen shots so the director can review the selection. Do not change nonselected neighbor shots. If a requested end pose requires a different start of the next shot, or conflicts with staging or a group's end state, report that continuity conflict; never claim a seamless transition that the plan does not contain. Suggest expanding the scope where needed.

Editable shot fields: action, framing, camera, view, hold, size (wide/medium/close/extreme), rest, hands, characters and people. Visible characters may be a subset of the original shot, never new identities. A character listed with an empty entry in people was brought in by the director: keep them, give them state, frame and motion, and name them in the action as {Name}. Singers/players and characters in a speaking film shot must remain. hands names a visible instrument player. Editable people fields: state, frame, motion, facing (left/right/camera/away), plays. All other fields must remain byte-for-byte equivalent as JSON. Keep clothing, props and story facts in state. Keep singing/playing flags. Preserve names and {Name} tokens exactly as the existing plan uses them.

Make action, pose, motion and camera mutually consistent. 'Back to camera' is the required end pose, not an automatic 360-degree turn. Describe left/right relative to the character or image explicitly. A visual instruction cannot change the audio or invent a solo that is not in the song. Do not paste the instruction into the video prompt.

Return JSON {changes:[{shotId,after: COMPLETE updated shot object}],conflicts:[string]}. Return at least one chosen shot (unchanged if already compliant), or conflicts explaining why no edit can be made.`

/** The response envelope is constrained; per-shot protected fields and identity enums are checked by code as well. */
export function directionPrompt(input: unknown): AskOptions {
    return {
        reasoning: 'none',
        label: 'Direction proposal',
        maxTokens: 16384,
        instructions: directionInstructions,
        input: JSON.stringify(input),
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['changes', 'conflicts'],
            properties: {
                changes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['shotId', 'after'],
                        properties: {
                            shotId: {type: 'string'},
                            after: {type: 'object', additionalProperties: true},
                        },
                    },
                },
                conflicts: {type: 'array', items: {type: 'string'}},
            },
        },
    }
}
