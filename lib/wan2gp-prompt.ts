// A clip's prompt in the form wan2gp's H3 Ref2VA renders well (#1214, tests in #1204): short, the people before the place, one
// continuous shot, the singing without lyrics - the clip's sound is the soundtrack the video follows (`AS`). The LLM writes it from
// the clip's ComfyUI prompt; code only states the picture order and counts what comes back.

/** At most this many characters: the hand-written prompt that rendered well had about 1100, ours has 7000-8000. */
export const WAN2GP_PROMPT_CHARS = 2500
// what the model is asked for: it overshoots a stated limit - asked for 2500, 8 of 43 clips came back with 2549 to 3166 even on the
// second try; asked for less, the answer lands under the limit code checks
const ASKED_CHARS = 2000

type Picture = {kind: string}

// people first (a prop goes with its person), a frame the clip starts from next, the place last - as wan2gp's Showrunner lays
// them out; a place as <Picture 1> made wan2gp open on the empty room
const ORDER: Record<string, number> = {character: 0, prop: 1, frame: 2, location: 3}

/** The clip's pictures in wan2gp's order: indexes into the clip's own list, a stable sort by kind. */
export function wan2gpPictureOrder(pictures: Picture[]): number[] {
    return pictures
        .map((p, i) => ({i, rank: ORDER[p.kind] ?? 2}))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map(p => p.i)
}

const instructions = `You rewrite a MiniMax H3 reference-to-video prompt into a much shorter one for another renderer.
Keep the sections, in this order: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music.
The pictures are numbered anew - the input says which old picture is which new one. Use only the new numbers. Define the subjects in
the order of the new pictures: the people first, the place last.
Keep: who is where, what they do and feel, the camera framing and its movement, the look of each person and of the place in one short
phrase each.
Write ONE continuous shot: no [Shot 2], no cuts - when the input cuts, follow its last framing with one camera move.
Drop: floor plans, continuity lists, film or camera references, repeated descriptions, every time stamp, every lyric and <d> tag,
every <Audio N> label. Whoever sings or speaks "sings with natural lip movements synchronized"; everybody else keeps the lips still.
The summary starts with "[reference generation + audio reference]".
In retention_analysis the people are fully_preserved and the place is weak_reference: the shot opens on the people inside the place,
never on the empty place.
Write the prompt only, nothing before or after it.`
// a changed text asks every clip again: it is part of each clip's fingerprint (lib/pipeline/wan2gp-prompts.ts)
export const WAN2GP_PROMPT_RULES = instructions

/** What the model is told for one clip: its prompt and how the pictures are numbered for wan2gp. */
export function wan2gpPromptInput(prompt: string, pictures: {kind: string; name: string}[], order: number[], chars = ASKED_CHARS) {
    const renumbered = order.map((old, i) => `<Picture ${old + 1}> (${pictures[old]!.kind}: ${pictures[old]!.name}) is now <Picture ${i + 1}>`)
    return `At most ${chars} characters.\nPictures:\n${renumbered.join('\n')}\n\nThe prompt:\n${prompt}`
}

/** Why an answer does not do, or undefined: code counts, it does not judge the writing. */
export function wan2gpPromptProblem(answer: string, pictures: number, chars = WAN2GP_PROMPT_CHARS): string | undefined {
    const problems = [
        answer.length > chars ? `It is ${answer.length} characters; the limit is ${chars}.` : '',
        ...Array.from({length: pictures}, (_, i) => (answer.includes(`<Picture ${i + 1}>`) ? '' : `<Picture ${i + 1}> is missing.`)),
        [...answer.matchAll(/<Picture (\d+)>/g)].some(m => Number(m[1]) < 1 || Number(m[1]) > pictures) ? `There are only ${pictures} pictures.` : '',
        /<d>|<\/d>/.test(answer) ? 'It still has <d> lyrics.' : '',
        /<Audio \d+>/.test(answer) ? 'It still has an <Audio N> label.' : '',
        /\[Shot [2-9]\]/.test(answer) ? 'It still has more than one shot.' : '',
    ].filter(Boolean)
    return problems.length ? problems.join(' ') : undefined
}

export type PromptAsker = (options: {instructions: string; input: string; label: string}) => Promise<string>

/**
 * The short prompt of one clip, or undefined when two answers did not pass the checks (the clip then renders on wan2gp from its own
 * prompt, as before). The second ask shows the model its first answer and what was wrong with it: without that the first answer
 * kept 6600 of 7600 characters, with it 1800.
 */
export async function writeWan2gpPrompt(
    ask: PromptAsker,
    clip: {id: string; prompt: string; assets: {pictures: {kind: string; name: string}[]}},
): Promise<{prompt: string} | {problem: string}> {
    const order = wan2gpPictureOrder(clip.assets.pictures)
    const input = wan2gpPromptInput(clip.prompt, clip.assets.pictures, order)
    const first = (await ask({instructions, input, label: `${clip.id} · wan2gp prompt`})).trim()
    const problem = wan2gpPromptProblem(first, order.length)
    if (!problem) return {prompt: first}
    const again = (
        await ask({
            instructions,
            input: `${input}\n\nYour answer was:\n${first}\n\n${problem} Write it again in at most ${ASKED_CHARS} characters: one short phrase per subject, a one-sentence summary, a few sentences of description.`,
            label: `${clip.id} · wan2gp prompt, again`,
        })
    ).trim()
    const left = wan2gpPromptProblem(again, order.length)
    return left ? {problem: left} : {prompt: again}
}
