import {describe, expect, test} from 'bun:test'
import {adaptScreenplayPrompt, screenplayParsePrompt, screenplayWritePrompt} from './prompts.ts'
import type {Brief, Outline, Screenplay} from './types.ts'

const brief: Brief = {
    mode: 'idea',
    title: 'The Last Light',
    language: 'en',
    logline: 'A keeper protects a lighthouse from a storm.',
    genre: 'drama',
    tone: 'quiet',
    setting: 'coast, present day',
}
const outline: Outline = {
    characters: [{name: 'Mara', role: 'keeper', appearance: 'an older woman', voice: 'low and calm'}],
    scenes: [{heading: 'INT. LIGHTHOUSE - NIGHT', characters: ['Mara'], summary: 'Mara watches the storm.', purpose: 'She chooses to stay.', seconds: 20}],
}
const screenplay: Screenplay = {
    title: brief.title,
    language: brief.language,
    scenes: [
        {
            id: 's1',
            setting: 'INT',
            location: 'LIGHTHOUSE',
            time: 'NIGHT',
            shot: 'CLOSE UP - LAMP',
            elements: [{type: 'action', text: 'Mara watches the lamp.'}],
        },
    ],
}

describe('screenplay prompt schemas', () => {
    test('writing and parsing require a scene and preserve optional shot and typed elements', () => {
        const writingSchema = screenplayWritePrompt(brief, outline).schema
        const parsingSchema = screenplayParsePrompt('INT. LIGHTHOUSE - NIGHT', brief.language).schema
        const expected = {
            properties: {
                scenes: {
                    minItems: 1,
                    items: {
                        required: ['setting', 'location', 'time', 'elements'],
                        properties: {
                            setting: {enum: ['INT', 'EXT', 'INT/EXT']},
                            shot: {type: 'string'},
                            elements: {
                                items: {
                                    anyOf: [
                                        {properties: {type: {const: 'action'}}},
                                        {properties: {type: {const: 'dialogue'}, kind: {enum: ['spoken', 'offscreen', 'voiceover']}}},
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        }

        expect(writingSchema).toMatchObject(expected)
        expect(parsingSchema).toMatchObject(expected)
    })

    test('adaptation adds required character details without changing the screenplay scene schema', () => {
        const schema = adaptScreenplayPrompt(screenplay, brief, {
            staying: [],
            added: [{name: 'Ivo', role: 'a visiting sailor'}],
            removed: [],
        }).schema

        expect(schema).toMatchObject({
            required: ['characters', 'scenes'],
            properties: {
                characters: {
                    type: 'array',
                    items: {
                        required: ['name', 'role', 'appearance', 'voice'],
                        properties: {name: {type: 'string'}, role: {type: 'string'}, appearance: {type: 'string'}, voice: {type: 'string'}},
                    },
                },
                scenes: {
                    minItems: 1,
                    items: {required: ['setting', 'location', 'time', 'elements']},
                },
            },
        })
    })
})