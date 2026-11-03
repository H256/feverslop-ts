import {cli} from '../lib/cli.ts';
// The story of a music video told anew for the cast as it is now (#542): who is in it was changed by hand on the workspace's
// Casting page, and the story still tells of the old cast. The language model writes it again with the same plot, places and
// length - only what the people changed is changed. Nothing is planned: the result waits as a proposal in
// output/story-proposal.json, and the Story page shows it next to the story to take it or drop it.
// usage: bun run adapt-story <project-id>
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {loadProjectConfig} from "../lib/config.ts";
import {ask, configureLlm} from "../lib/llm.ts";
import {log, styles} from "../lib/log.ts";
import {projectDir, projectExists, validProjectId} from "../lib/project-setup.ts";
import type {Project} from "../lib/project.ts";
import {loadSettings} from "../lib/settings.ts";
import {STORY_PROPOSAL, type StoryProposal, storyFingerprint} from "../lib/editor/preproduction.ts";
import {adaptStoryPrompt} from "../lib/prompts.ts";
cli('adapt-story')

const usage = 'usage: bun run adapt-story <project-id>'
const id = Bun.argv[2]
if (!id || !validProjectId(id) || !projectExists(id)) log.usageError(id ? `No project "${id}" in projects/` : 'No project id given', usage)
const dir = projectDir(id!)
const file = join(dir, 'project.json')
const data: Project = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
if (!data.story || !data.cast) log.usageError('the project has no story and cast yet - plan up to the cast first (bun index.ts <id> --until=cast)', usage)

const config = await loadProjectConfig(dir)
const settings = await loadSettings({projectModel: config.llm.model})
configureLlm(settings.llm)
log.step('Story', styles.muted(`${data.story!.split(/\s+/).length} words, told anew for ${data.cast!.characters.length} character(s) and ${data.cast!.locations.length} place(s)`))
const story = (await ask(adaptStoryPrompt(data.story!, data.cast!))).trim()
if (!story) throw new Error('the language model gave no story - run it again')
const proposal: StoryProposal = {story, for: storyFingerprint(data.story!)}
const out = join(dir, STORY_PROPOSAL)
mkdirSync(dirname(out), {recursive: true})
writeFileSync(out, JSON.stringify(proposal, null, 2) + '\n')
log.success(`A proposal of ${story.split(/\s+/).length} words in ${out} - take it or drop it on the Story page of the workspace`)
