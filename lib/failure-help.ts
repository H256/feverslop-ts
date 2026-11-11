import type {Explained} from '../shared/workspace.ts'

// What a failure of a run means and what to do about it (#819) - for the terminal and the workspace alike. Told by the messages
// of ComfyUI, the runtime, the file system and this program, never by a text of a language model. A failure that is not known
// here stays as it is: nothing is guessed.

type Known = Explained & {
    /** tells the failure by its message */
    is: RegExp
    /** the message already says what to do (a message of this program): the terminal adds nothing under it */
    said?: boolean
}

const KNOWN: Known[] = [
    {
        is: /out of memory/i,
        text: 'The render server ran out of memory on this job.',
        action: 'Repeat on another server, or render a shorter clip or at a smaller size ("videoResolution" in config.json, bun run config <id>).',
    },
    {
        is: /has not answered for|No ComfyUI server reachable/,
        text: 'A render server does not answer.',
        action: 'Start it again and repeat: a job that is still queued is picked up. Or repeat on another server.',
        said: true,
    },
    {
        is: /The LLM server .* does not answer|No LLM server configured/,
        text: 'The language model cannot be asked.',
        action: 'Start its server, or set another one with: bun run setup llm - then repeat: finished steps are kept.',
        said: true,
    },
    {
        is: /timed out|ETIMEDOUT|TimeoutError/i,
        text: 'A server took too long to answer.',
        action: 'See whether it is busy or has stopped (its own log), then repeat the command: finished steps and renders are kept.',
    },
    {
        is: /\b(EPERM|EBUSY)\b|held open by another program/,
        text: 'A file or folder of the project is held open by another program.',
        action: 'Close what has it open - a player, an editor, an explorer window in that folder, a paused video in the workspace - and repeat the command.',
    },
    {
        is: /InternalServerError|HTTP 5\d\d|\b50[0-4] (Internal|Bad Gateway|Service Unavailable|Gateway Timeout)/,
        text: 'A server answered with an error of its own.',
        action: 'Its own log says why (the LLM server or ComfyUI). Often it has run out of memory or lost its model: start it again, then repeat the command.',
    },
    {
        is: /did not (answer with|return) valid JSON|failed the JSON Schema|answer was cut off|gave no answer in/,
        text: 'The language model did not give a usable answer, also when asked again.',
        action: 'Repeat the command: the step is asked anew. If it keeps happening: another model or a lower reasoning effort (bun run setup llm-model).',
    },
    {is: /being worked on by another run/, text: 'Another run is working on this project.', action: 'Wait for it, or stop it.', said: true},
    {
        is: /Direction needs review/,
        text: 'The direction has instructions to look at: a run builds no clip before they are taken.',
        action: 'On the Direction page clear the leftovers of the old plan, edit or remove what is listed under "To decide", then Preview and Take - and run again.',
        page: 'direction',
        said: true,
    },
    {is: /casting\.json/, text: 'casting.json names something the library does not have.', action: 'Change the entry on the Casting page.', said: true},
]

const known = (failure: string) => KNOWN.find(k => k.is.test(failure))

/** What a failure means in plain words and what to do, for the failures that can be told surely. */
export function explainFailure(failure: string): Explained | undefined {
    const found = known(failure)
    return found && {text: found.text, action: found.action, ...(found.page ? {page: found.page} : {})}
}

/**
 * The line the terminal puts under a failure: what it means and what to do - only where the message is somebody else's
 * ("The operation timed out.", "EPERM: operation not permitted, rename …", a server's JSON) and does not say so itself.
 */
export function failureAdvice(failure: string): string | undefined {
    const found = known(failure)
    return found && !found.said ? `${found.text} ${found.action}` : undefined
}
