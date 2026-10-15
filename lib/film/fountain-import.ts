// Reads a screenplay in Fountain (https://fountain.io) into the structure the pipeline works on - the inverse of
// lib/film/fountain.ts. For a source that is Fountain this is code, not a language model: no dialogue line can be dropped,
// reworded or given to somebody else, and the order is the order of the file. What code cannot know - the English of a
// place and a time, the language of a line - is left to a small annotation step (annotatePrompt in prompts.ts).
//
// Read: title page (Title:, Language:), sluglines (INT. EXT. INT./EXT. I/E, forced with "."), character cues (upper case,
// or forced with "@") with (V.O.) (O.S.) (O.C.) (CONT'D) extensions, parentheticals, dialogue, action (also forced with "!"),
// centered text. Dropped: transitions, notes [[...]], boneyard, page breaks, sections (#), synopses (=).
// Not read - the source is then handled by the language model as before (parseFountain returns undefined): dual dialogue
// ("^"), text before the first slugline, a source without sluglines or without a character cue.

export type ImportedElement =
    | { type: 'action', text: string }
    | { type: 'dialogue', speaker: string, text: string, kind: 'spoken' | 'offscreen' | 'voiceover', delivery?: string, translation?: string, language?: string }
export type ImportedScene = { setting: 'INT' | 'EXT' | 'INT/EXT', location: string, time: string, shot?: string, elements: ImportedElement[] }
export type ImportedScreenplay = { title?: string, language?: string, scenes: ImportedScene[] }

const SLUGLINE = /^(?:(INT\.?\s*\/\s*EXT|INT\/EXT|I\s*\/\s*E|INT|EXT|EST)(?:\.\s*|\s+))(.+)$/i
const hasLower = (value: string) => value !== value.toLocaleUpperCase()
const hasLetter = (value: string) => /\p{L}/u.test(value)

/** "INT. THE HUT - NIGHT" -> setting, place, time. A heading with no " - " has no time: DAY, as the pipeline's default. */
function slugline(line: string): Omit<ImportedScene, 'elements'> | undefined {
    const forced = line.startsWith('.') && !line.startsWith('..')
    const body = forced ? line.slice(1).trim() : line
    const match = forced ? undefined : body.match(SLUGLINE)
    if (!forced && !match) return undefined
    const tag = match ? match[1]!.toUpperCase().replace(/[\s.]/g, '') : 'INT'
    const setting = tag === 'EXT' || tag === 'EST' ? 'EXT' : tag.includes('/') ? 'INT/EXT' : 'INT'
    const rest = (match ? match[2]! : body).replace(/\s*#[^#]*#\s*$/, '').trim()
    const dash = rest.search(/\s+[-–—]\s+(?!.*\s[-–—]\s)/)
    const location = (dash >= 0 ? rest.slice(0, dash) : rest).trim()
    const time = dash >= 0 ? rest.slice(dash).replace(/^\s*[-–—]\s*/, '').trim() : ''
    if (!location) return undefined
    return {setting, location, time: time || 'DAY'}
}

const EXTENSION = /\s*\((V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D\.?|CONT\.?)\)\s*$/i

export function parseFountain(source: string): ImportedScreenplay | undefined {
    const cleaned = source
        .replace(/\r\n?/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\[\[[\s\S]*?\]\]/g, '')
    const blocks = cleaned.split(/\n[ \t]*\n/).map(block => block.split('\n').map(line => line.replace(/\s+$/, '')).filter(line => line.trim() !== '')).filter(lines => lines.length)

    let title: string | undefined
    let language: string | undefined
    const scenes: ImportedScene[] = []
    let current: ImportedScene | undefined

    for (const [index, lines] of blocks.entries()) {
        const first = lines[0]!.trim()
        // title page: the first block, "Key: value" lines (a value may continue on indented lines)
        if (index === 0 && !slugline(first) && lines.every(l => /^\s+\S/.test(l) || /^[A-Za-z][A-Za-z ]*:\s*/.test(l)) && /^[A-Za-z][A-Za-z ]*:/.test(first)) {
            for (const line of lines) {
                const kv = line.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/)
                if (!kv) continue
                const key = kv[1]!.toLowerCase()
                if (key === 'title') title = kv[2]!.trim() || undefined
                if (key === 'language') language = kv[2]!.trim().toLowerCase() || undefined
            }
            continue
        }
        // a page break, a section, a synopsis
        if (/^={3,}$/.test(first) || /^#/.test(first) || /^=/.test(first)) continue

        const heading = lines.length === 1 || /^\./.test(first) || SLUGLINE.test(first) ? slugline(first) : undefined
        if (heading) {
            current = {...heading, elements: []}
            scenes.push(current)
            // a block that goes on after the slugline line: the rest is action
            const rest = lines.slice(1).join(' ').trim()
            if (rest) current.elements.push({type: 'action', text: rest})
            continue
        }
        // everything else belongs to a scene: text before the first slugline cannot be placed - the model reads the source
        if (!current) return undefined

        // transitions: "CUT TO:", "FADE OUT." or forced with ">"
        if (lines.length === 1 && ((/^>/.test(first) && !/<\s*$/.test(first)) || (!hasLower(first) && /\bTO:$/.test(first)))) continue
        // centered text "> text <" is action
        const centered = lines.length === 1 ? first.match(/^>\s*(.+?)\s*<$/) : null
        if (centered) { current.elements.push({type: 'action', text: centered[1]!}); continue }
        // forced action
        if (first.startsWith('!')) {
            current.elements.push({type: 'action', text: [first.slice(1).trim(), ...lines.slice(1).map(l => l.trim())].join(' ').trim()})
            continue
        }

        // a character cue: upper case (or forced with @), and something under it
        const forcedCue = first.startsWith('@')
        const cueText = forcedCue ? first.slice(1).trim() : first
        if (lines.length > 1 && (forcedCue || (!hasLower(cueText) && hasLetter(cueText) && !/^\(/.test(cueText)))) {
            if (/\^\s*$/.test(cueText)) return undefined // dual dialogue
            const kindMatch = cueText.match(EXTENSION)
            const kind: 'spoken' | 'offscreen' | 'voiceover' = kindMatch && /^v/i.test(kindMatch[1]!) ? 'voiceover' : kindMatch && /^o/i.test(kindMatch[1]!) ? 'offscreen' : 'spoken'
            const speaker = cueText.replace(EXTENSION, '').replace(EXTENSION, '').trim()
            if (!speaker) return undefined
            let delivery: string | undefined
            let translation: string | undefined
            const spoken: string[] = []
            for (const raw of lines.slice(1)) {
                const line = raw.trim()
                const paren = line.match(/^\((.*)\)$/)
                if (paren) {
                    // before the first words: how it is said; after them: the translation the script gives of the line
                    if (!spoken.length) delivery = delivery ? `${delivery}, ${paren[1]!.trim()}` : paren[1]!.trim()
                    else translation = translation ? `${translation} ${paren[1]!.trim()}` : paren[1]!.trim()
                } else spoken.push(line)
            }
            const text = spoken.join(' ').trim()
            if (!text) continue
            current.elements.push({type: 'dialogue', speaker, text, kind, ...(delivery ? {delivery} : {}), ...(translation ? {translation} : {})})
            continue
        }

        current.elements.push({type: 'action', text: lines.map(l => l.trim()).join(' ').trim()})
    }

    if (!scenes.length) return undefined
    if (!scenes.some(scene => scene.elements.some(e => e.type === 'dialogue'))) return undefined
    return {...(title ? {title} : {}), ...(language ? {language} : {}), scenes: scenes.filter(scene => scene.elements.length)}
}

/** What the annotation step answers for a scene - every field optional, a missing or unusable one leaves the scene as parsed. */
type SceneNotes = { location?: unknown, time?: unknown, shot?: unknown, actions?: unknown, lines?: unknown }

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/**
 * Merges the annotation into the parsed screenplay: place and time in English, the actions in plain English, and per
 * dialogue line its language and delivery. A line's words, its speaker and the order never come from the answer - and an
 * answer whose lists do not match the scene (a different number of actions or lines) is not used for that scene at all.
 */
export function applyAnnotations(parsed: ImportedScreenplay, answer: unknown): ImportedScreenplay {
    const scenes = (answer && typeof answer === 'object' ? (answer as { scenes?: unknown }).scenes : undefined)
    const notes: SceneNotes[] = Array.isArray(scenes) ? scenes : []
    return {
        ...parsed,
        scenes: parsed.scenes.map((scene, i) => {
            const note = notes[i] && typeof notes[i] === 'object' ? notes[i]! : {}
            const actionCount = scene.elements.filter(e => e.type === 'action').length
            const lineCount = scene.elements.length - actionCount
            const actions = Array.isArray(note.actions) && note.actions.length === actionCount && note.actions.every(a => clean(a)) ? note.actions.map(clean) : undefined
            const lines = Array.isArray(note.lines) && note.lines.length === lineCount ? note.lines as Record<string, unknown>[] : undefined
            let a = 0
            let l = 0
            return {
                ...scene,
                ...(clean(note.location) ? {location: clean(note.location)} : {}),
                ...(clean(note.time) ? {time: clean(note.time)} : {}),
                ...(clean(note.shot) ? {shot: clean(note.shot)} : {}),
                elements: scene.elements.map((element): ImportedElement => {
                    if (element.type === 'action') return actions ? {...element, text: actions[a++]!} : element
                    const entry = lines?.[l++]
                    if (!entry || typeof entry !== 'object') return element
                    const language = clean(entry.language).toLowerCase()
                    const delivery = clean(entry.delivery)
                    return {
                        ...element,
                        ...(/^[a-z]{2,3}$/.test(language) ? {language} : {}),
                        ...(element.delivery ? {delivery: delivery || element.delivery} : {}),
                    }
                }),
            }
        }),
    }
}
