// A check over a composed clip prompt (#825). The composers build a prompt from many parts, and what went wrong between them
// reached ComfyUI unnoticed: "the the empty rooms" in every clip of a project, a subject named that no picture stands for.
// This reads the text the code itself put together - its labels, its times, its joins - never what a language model meant.

export type CheckedClip = {
    id: string
    prompt: string
    duration?: number
    assets?: {pictures?: {label: string; subject?: string}[]; audio?: {label: string}[]}
}

/** From this many characters on a prompt is said to be long: the longest of a real project were 15,000. */
export const LONG_PROMPT = 12000

const LABEL = /<(Subject|Picture|Audio) \d+>/g
// sung or spoken words are the song's: "la la", "no no no" are not ours to judge
const withoutLines = (prompt: string) => prompt.replace(/<d>[\s\S]*?<\/d>/g, '<d></d>')
const seconds = (stamp: string) => {
    const [minutes, rest] = stamp.split(':')
    return Number(minutes) * 60 + Number(rest)
}

/** What is wrong with a composed prompt, each as one line - empty when nothing is. */
export function checkPrompt(clip: CheckedClip): string[] {
    const found: string[] = []
    const text = withoutLines(clip.prompt)

    // a word twice in a row: two parts joined that each brought it ("the" + "the empty rooms")
    const doubled = new Set<string>()
    for (const m of text.matchAll(/\b([A-Za-z]+) \1\b/gi)) doubled.add(`${m[1]} ${m[1]}`.toLowerCase())
    if (doubled.size) found.push(`a word twice in a row: ${[...doubled].map(d => `"${d}"`).join(', ')}`)

    // a join with nothing between its marks
    const empty = [...new Set(text.match(/; ;|, ,|,;|\(\)|\bof {2,}|\bin {2,}| \.(?=\s|$)|: \.|, \./g) ?? [])]
    if (empty.length) found.push(`an empty part between two joins: ${empty.map(e => `"${e}"`).join(', ')}`)

    // every label the prompt uses stands for something the clip has, and everything the clip has is used
    if (clip.assets) {
        const used = new Set(text.match(LABEL) ?? [])
        const has = new Set([
            ...(clip.assets.pictures ?? []).flatMap(p => [p.label, ...(p.subject ? [p.subject] : [])]),
            ...(clip.assets.audio ?? []).map(a => a.label),
        ])
        const unknown = [...used].filter(label => !has.has(label))
        if (unknown.length) found.push(`named but not given to the clip: ${unknown.join(', ')}`)
        const unused = [...has].filter(label => !used.has(label))
        if (unused.length) found.push(`given to the clip but never named: ${unused.join(', ')}`)
    }

    // the shots in order, and none after the clip has ended
    const cuts = [...text.matchAll(/\[Shot (\d+)\] At (\d{2}:\d{2}(?:\.\d+)?)/g)].map(m => ({shot: Number(m[1]), at: seconds(m[2]!)}))
    for (let i = 1; i < cuts.length; i++)
        if (cuts[i]!.at <= cuts[i - 1]!.at) found.push(`[Shot ${cuts[i]!.shot}] cuts in before [Shot ${cuts[i - 1]!.shot}] has begun`)
    if (clip.duration !== undefined) for (const cut of cuts) if (cut.at >= clip.duration) found.push(`[Shot ${cut.shot}] cuts in after the clip has ended`)
    const numbers = [...text.matchAll(/^\[Shot (\d+)\]/gm)].map(m => Number(m[1]))
    if (numbers.some((n, i) => n !== i + 1)) found.push(`the shots are not numbered in order: ${numbers.join(', ')}`)

    if (clip.prompt.length >= LONG_PROMPT) found.push(`${clip.prompt.length} characters long`)
    return found
}

/** The findings of all clips, one line per clip that has some: "slot-007: a word twice in a row: "the the"". */
export const checkPrompts = (clips: CheckedClip[]) => clips.flatMap(clip => checkPrompt(clip).map(finding => `${clip.id}: ${finding}`))
