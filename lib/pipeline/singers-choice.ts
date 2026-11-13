import type {ProjectConfig} from '../config.ts'
import {askJson} from '../llm.ts'
import {log} from '../log.ts'
import {sungLines} from '../lyrics.ts'
import type {Character, Location, LyricSection, Singing} from '../project.ts'
import {voiceRules} from '../prompts.ts'
import {toSlug} from '../slug.ts'

// The singers of a music video (index.ts step 5b, #841): who of the cast sings, and with several, who sings which line - and what the
// story beats then have to do so that they can be lip-synced.

/** What the choice is made from: the cast, the lyrics and the story as the run has them. */
export type SingerStory = {
    cast: {characters: Character[]; locations: Location[]}
    config: ProjectConfig
    lyricSections: LyricSection[]
    lyrics: string
    storySummary: string
}

/**
 * The singers from config.json: names or ids matched loosely against the cast, or ["auto"] - the LLM picks the lead
 * singer(s). With several singers, the LLM also decides who sings which line.
 */
export async function chooseSingers(wanted: string[], story: SingerStory): Promise<Singing> {
    const {cast, config, lyricSections, lyrics, storySummary} = story
    const characters = cast.characters
    const lines = sungLines(lyricSections)
    const castList = JSON.stringify(characters.map(c => ({id: c.id, name: c.name, role: c.role})))
    const known = (ids: unknown) => (Array.isArray(ids) ? ids : []).filter((id): id is string => characters.some(c => c.id === id))
    let singers: string[]

    if (wanted[0] === 'auto') {
        const picked = await askJson<{singers: string[]}>({
            input: `Pick the singers of this music video from the cast: the characters who sing the lyrics on screen.
Pick the lead first, and prefer an individual character for it: the one whose story the song tells, or who calls the lines out. A group character (e.g. "Miners") sings as well when the lyrics have group parts ("we", a chorus, a shouted refrain, lines the others answer) - then pick the lead and the group both, so that the verses can be the lead's and the refrains the group's. Pick the group alone only if the whole song is clearly sung by the group as one voice and nobody in it leads. A party made of individual characters (a crew or band of named members) is no group entry: its refrains are sung by the lead together with up to two of its members, the ones with the most to do in the story - the rest of the party stays on screen. Several individual singers only if the lyrics clearly are a dialogue or duet between different characters. Three singers at most. Characters that fight, hunt or threaten the singers do not sing.
${voiceRules(config.singerVoice).pick}Answer only with JSON: {"singers": ["<character id>"]}
---
cast: ${castList}
lyrics:
${lyrics}
---
story summary:
${storySummary}`,
            instructions: 'You are a music video director who casts the singers of a performance video. Answer only with JSON.',
            schema: {
                type: 'object',
                additionalProperties: false,
                required: ['singers'],
                properties: {singers: {type: 'array', minItems: 1, maxItems: 3, items: {enum: characters.map(c => c.id)}}},
            },
        })
        singers = known(picked.singers)
        if (!singers.length)
            throw new Error(`The LLM picked no singer from the cast (${JSON.stringify(picked.singers)}) - run again, or name the singers in config.json`)
    } else {
        // a name the cast does not carry letter for letter (config.json in the song's language, the cast in English: "schamanin" / "Shamaness")
        // is asked once: the LLM knows which character is meant, code does not guess
        const unmatched = wanted.filter(name => !findCharacter(characters, name))
        const resolved = new Map<string, string>()
        if (unmatched.length) {
            const mapped = await askJson<{singers: {name: string; id: string | null}[]}>({
                input: `config.json names these singers of a music video, but not all of them are spelled like the characters of the cast (another language, a nickname, an epithet). For every name say which character of the cast it means - or null if none does.
Mind the grammatical gender of the name (German "Schamanin" is the woman, "Schamane" the man) and take the character of that gender, even if another character has the more similar spelling.
${voiceRules(config.singerVoice).pick}Answer only with JSON: {"singers": [{"name": "<name as given>", "id": "<character id or null>"}]}
---
names: ${JSON.stringify(unmatched)}
cast: ${castList}
story summary:
${storySummary}`,
                instructions: 'You match names to the characters of a cast. Answer only with JSON.',
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['singers'],
                    properties: {
                        singers: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['name', 'id'],
                                properties: {name: {enum: unmatched}, id: {enum: [...characters.map(c => c.id), null]}},
                            },
                        },
                    },
                },
            })
            for (const m of mapped.singers ?? []) {
                const [id] = known([m.id])
                if (id) resolved.set(m.name, id)
            }
        }
        singers = [
            ...new Set(
                wanted.flatMap(name => {
                    const character = findCharacter(characters, name)
                    const id = character?.id ?? resolved.get(name)
                    if (!id) log.warn(`singers: "${name}" is not in the cast - ignored`)
                    else if (!character) log.step('Singers', `"${name}" is ${id}`)
                    return id ? [id] : []
                }),
            ),
        ]

        if (!singers.length)
            throw new Error(
                `singers: none of ${wanted.join(', ')} is in the cast. The characters are: ${characters.map(c => `${c.name} (${c.id})`).join(', ')}`,
            )
    }
    if (singers.length === 1) return {singers, lines: lines.map(l => ({line: l.line, text: l.text, singers}))}

    const assigned = await askJson<{lines: {line: number; singers: string[]}[]}>({
        reasoning: 'medium',
        // thinking at medium easily takes 8k tokens on its own, the long JSON comes on top
        maxTokens: Math.max(16384, lines.length * 100),
        input: `These characters sing the song of a music video: ${JSON.stringify(singers)}.
Decide who sings which line. A line is sung by one singer, or by several together (duet or choir lines, e.g. a chorus).
Follow the lyrics and the story: who would say these words? Keep a verse with one singer unless its lines answer each other. When a group, or companions of the lead, are among the singers, they sing the refrains and the shouted group lines - together with the lead, so name all of them - and the lead alone sings the verses; the group alone sings only a line that is clearly only theirs.
Answer only with JSON: {"lines": [{"line": 0, "singers": ["<character id>"]}, ...]} - one entry for every line number below.
---
cast: ${castList}
lines: ${JSON.stringify(lines.map(l => ({line: l.line, section: l.section, text: l.text})))}
---
story summary:
${storySummary}`,
        instructions: 'You are a music video director who splits a song between its singers. Answer only with JSON.',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['lines'],
            properties: {
                lines: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['line', 'singers'],
                        properties: {line: {enum: lines.map(l => l.line)}, singers: {type: 'array', minItems: 1, items: {enum: singers}}},
                    },
                },
            },
        },
    })
    // a model that loops repeats a singer in a line ("lyra, kaelen, lyra, ...") - each sings it once; uniqueItems is not
    // in the schema, the server's grammar compiler refuses it (llama.cpp/vLLM: "Unimplemented keys")
    const byLine = new Map((assigned.lines ?? []).map(l => [l.line, [...new Set(known(l.singers).filter(id => singers.includes(id)))]]))
    const missing = lines.filter(l => !byLine.get(l.line)?.length)
    if (missing.length) log.warn(`${missing.length} line(s) got no singer - sung by ${singers[0]}`)
    return {singers, lines: lines.map(l => ({line: l.line, text: l.text, singers: byLine.get(l.line)?.length ? byLine.get(l.line)! : [singers[0]!]}))}
}

// "Thorin" finds "thorin" and "thorin-oakenshield", "miner" finds "miners"
function findCharacter(characters: Character[], name: string) {
    const slug = toSlug(name)
    const tokens = (id: string) => id.split('-').map(t => t.replace(/s$/, ''))
    return characters.find(c => c.id === slug || toSlug(c.name) === slug) ?? characters.find(c => tokens(slug).every(t => tokens(c.id).includes(t)))
}

// what the story beats must do so the singers can be lip-synced
export function performanceRules({singers, lines}: Singing, {cast, lyricSections}: Pick<SingerStory, 'cast' | 'lyricSections'>) {
    const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    const sectionOf = new Map(sungLines(lyricSections).map(l => [l.line, l.section]))
    const bySection = new Map<string, Set<string>>()
    for (const l of lines) {
        const section = sectionOf.get(l.line) ?? ''
        if (!bySection.has(section)) bySection.set(section, new Set())
        for (const id of l.singers) bySection.get(section)!.add(id)
    }
    return `
This is a performance music video: ${singers.map(nameOf).join(', ')} ${singers.length > 1 ? 'sing' : 'sings'} the lyrics on screen, lip-synced, while acting out the story.
Sections with vocals and who sings them: ${[...bySection].map(([section, ids]) => `${section} (${[...ids].join(', ')})`).join('; ')}.
Sections without vocals have no singing - the story plays freely there.
For every beat that plays while the song has vocals:
- the singer(s) of that section are on screen: their ids are in "characterIds".
- they sing while they act, e.g. "{Thorin} sings while forging the blade", "{Vael} sings through the blow she takes from the orc" - the mouth stays in view (three-quarter or profile is fine, looking at what the story has them look at), no hidden faces, no masks or objects over the mouth.
`
}
