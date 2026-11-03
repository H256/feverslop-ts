import {cli} from '../lib/cli.ts';
// The story of a music video (a film: its screenplay), as the workspace's Story page has it - CLI first (#548). Without an option
// it is printed. --set replaces it by a text of your own, and what was planned from the old one goes. --adapt has the language model
// tell it anew for the cast as it is now: a proposal (output/story-proposal.json), taken with --take or dropped with --drop.
// --rename puts new names of the cast into it. Nothing is rendered; the next plan run makes again what went.
// usage: bun run story <project-id> [--film] [--out=story.txt | --set=story.txt | --adapt | --take | --drop | --rename="Mara Vey=Lena Rook"]
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {parseArgs} from "node:util";
import {loadProjectConfig} from "../lib/config.ts";
import {ask, configureLlm} from "../lib/llm.ts";
import {log, styles} from "../lib/log.ts";
import type {Project} from "../lib/project.ts";
import {adaptStoryPrompt} from "../lib/prompts.ts";
import {loadSettings} from "../lib/settings.ts";
import {commandTarget, dropStoryProposal, planCommand, readBook, STORY_PROPOSAL, type StoryProposal, storyFingerprint, writeStory, writeStoryForCast} from "../lib/editor/preproduction.ts";
cli('story')

const usage = 'usage: bun run story <project-id> [--film] [--out=story.txt | --set=story.txt | --adapt | --take | --drop | --rename="Old Name=New Name"]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2), allowPositionals: true,
            options: {
                film: {type: 'boolean', default: false},
                set: {type: 'string'},
                adapt: {type: 'boolean', default: false},
                take: {type: 'boolean', default: false},
                drop: {type: 'boolean', default: false},
                rename: {type: 'string', multiple: true},
                out: {type: 'string'},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const target = commandTarget(positionals[0], args.film)
if (typeof target === 'string') log.usageError(target, usage)
const t = target as Exclude<typeof target, string>
const changes = [args.set !== undefined, args.adapt, args.take, args.drop, !!args.rename?.length].filter(Boolean).length
if (changes > 1) log.usageError('one of --set, --adapt, --take, --drop and --rename at a time', usage)
if (changes && t.kind === 'film') log.usageError('a film\'s screenplay is changed in its script (input/) or in project.json (screenplay) - here it is printed', usage)

const dropped = (steps: string[]) => steps.length
    ? log.step('Dropped', `${steps.join(', ')} ${styles.muted('- the next plan run makes them again, the language model only')}`)
    : log.step('Dropped', styles.muted('nothing - nothing was planned from it yet'))

if (args.set !== undefined) {
    if (!existsSync(args.set)) log.usageError(`no file ${args.set}`, usage)
    const result = await writeStory(t, readFileSync(args.set, 'utf8'))
    if (!result.changed) log.success('the story is the same - nothing changed')
    else {
        dropped(result.dropped)
        log.next(planCommand(t, 'story'))
        log.success('the story is saved')
    }
} else if (args.adapt) {
    // the language model tells the story anew for the cast there is now: a proposal next to the story, nothing changes yet
    const data: Project = JSON.parse(readFileSync(join(t.dir, 'project.json'), 'utf8'))
    if (!data.story || !data.cast) log.usageError(`no story and cast yet - plan up to the cast first: bun index.ts ${t.id} --until=cast`, usage)
    const config = await loadProjectConfig(t.dir)
    configureLlm((await loadSettings({projectModel: config.llm.model})).llm)
    log.step('Story', styles.muted(`${data.story!.split(/\s+/).length} words, told anew for ${data.cast!.characters.length} character(s) and ${data.cast!.locations.length} place(s)`))
    const story = (await ask(adaptStoryPrompt(data.story!, data.cast!))).trim()
    if (!story) throw new Error('the language model gave no story - run it again')
    const out = join(t.dir, STORY_PROPOSAL)
    mkdirSync(dirname(out), {recursive: true})
    writeFileSync(out, JSON.stringify({story, for: storyFingerprint(data.story!)} satisfies StoryProposal, null, 2) + '\n')
    log.step('Proposal', `${story.split(/\s+/).length} words in ${out}`)
    log.next(`bun run story ${t.id} --take   (or --drop; the workspace shows it next to the story)`)
    log.success('a story told anew for the cast')
} else if (args.take) {
    const result = await writeStoryForCast(t, {proposal: true})
    dropped(result.dropped)
    log.next(planCommand(t, 'story'))
    log.success('the new story is taken - the cast, the singers and the looks stay')
} else if (args.drop) {
    dropStoryProposal(t)
    log.success('the proposal is dropped - the story stays as it is')
} else if (args.rename?.length) {
    const renamed = args.rename.map(pair => {
        const [from, to] = pair.split('=').map(s => s?.trim())
        if (!from || !to) log.usageError(`--rename takes "Old Name=New Name", not "${pair}"`, usage)
        return {from: from!, to: to!}
    })
    const result = await writeStoryForCast(t, {renamed})
    if (!result.changed) log.success('none of these names is in the story - nothing changed')
    else {
        dropped(result.dropped)
        log.next(planCommand(t, 'story'))
        log.success(`the new names are in the story: ${renamed.map(r => `${r.from} → ${r.to}`).join(', ')}`)
    }
} else {
    // printed as it is, or written to a file to be changed and given back with --set
    const book = readBook(t)
    if (book.text === undefined) log.usageError(`no ${t.kind === 'film' ? 'screenplay' : 'story'} yet - plan it: ${t.kind === 'film' ? 'bun film.ts' : 'bun index.ts'} ${t.id} --until=story`, usage)
    if (args.out !== undefined) {
        writeFileSync(args.out, book.text!.trimEnd() + '\n')
        log.next(`change ${args.out}, then: bun run story ${t.id} --set=${args.out}`)
        log.success(`the ${t.kind === 'film' ? 'screenplay' : 'story'} is in ${args.out}`)
    } else log.info(book.text)
    if (book.proposal) log.warn(`a story told anew for the cast waits: bun run story ${t.id} --take, or --drop (${STORY_PROPOSAL})`)
}
