import type {Screenplay} from "./types.ts";

// Fountain (https://fountain.io) is the plain-text screenplay format every screenwriting tool reads - the project's
// screenplay as films/<id>/screenplay.fountain, for reading and for pasting into an editor. The pipeline itself works
// on project.json, not on this file.

const upper = (text: string) => text.toLocaleUpperCase()

// a cue is only recognised as a character in Fountain when it is upper case - scripts without letter case (Chinese,
// Japanese, ...) are forced with a leading "@"
const cue = (speaker: string) => upper(speaker) === speaker.toLocaleLowerCase() ? `@${speaker}` : upper(speaker)

export function screenplayToFountain(screenplay: Screenplay) {
    const lines = [`Title: ${screenplay.title}`, `Language: ${screenplay.language}`, '']
    for (const scene of screenplay.scenes) {
        lines.push(`${scene.setting}. ${upper(scene.location)} - ${upper(scene.time)}`, '')
        for (const element of scene.elements) {
            if (element.type === 'action') {
                lines.push(element.text, '')
                continue
            }
            const extension = element.kind === 'voiceover' ? ' (V.O.)' : element.kind === 'offscreen' ? ' (O.S.)' : ''
            lines.push(`${cue(element.speaker)}${extension}`)
            if (element.delivery) lines.push(`(${element.delivery})`)
            lines.push(element.text, '')
        }
    }
    return `${lines.join('\n').trim()}\n`
}

// The screenplay as plain text for a prompt - the Fountain without its title page; numbered: every scene heading starts with "[Scene n]" (a prompt that has to point at scenes)
export function screenplayToText(screenplay: Screenplay, numbered = false) {
    const text = screenplayToFountain(screenplay).split('\n').slice(3)
    if (!numbered) return text.join('\n').trim()
    const headings = screenplay.scenes.map(scene => `${scene.setting}. ${upper(scene.location)} - ${upper(scene.time)}`)
    let n = 0
    return text.map(line => n < headings.length && line === headings[n] ? `[Scene ${++n}] ${line}` : line).join('\n').trim()
}
