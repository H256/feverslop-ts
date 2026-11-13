import {describe, expect, test} from 'bun:test'
import {defaults, type ProjectConfig} from './config.ts'
import {projectInputs, stepUsed} from './inputs.ts'
import {builtOn} from './project.ts'
import {castProps, propName} from './props.ts'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

describe('the props of a music video, built from the cast (#944)', () => {
    test('one per character with a prop, by the character, the words as its description', () => {
        expect(castProps([{id: 'kael', prop: 'an electric guitar'}, {id: 'veyra', prop: 'an obsidian drum kit.'}, {id: 'mira'}])).toEqual({
            kael: {id: 'electric-guitar', name: 'electric guitar', description: 'an electric guitar'},
            veyra: {id: 'obsidian-drum-kit', name: 'obsidian drum kit', description: 'an obsidian drum kit'},
        })
    })

    test('the same prop of two characters gets an id each', () => {
        const props = castProps([
            {id: 'a', prop: 'a bass guitar'},
            {id: 'b', prop: 'the bass guitar'},
        ])
        expect([props.a!.id, props.b!.id]).toEqual(['bass-guitar', 'bass-guitar-2'])
    })

    test('a name without the article or possessive in front', () => {
        expect(propName('her battered acoustic guitar')).toBe('battered acoustic guitar')
        expect(propName('Banjo')).toBe('Banjo')
        expect(propName('a')).toBe('a')
    })
})

describe('the propPictures setting (#944)', () => {
    const config = (propPictures: boolean) => ({...defaults, alignLyrics: false, propPictures}) as ProjectConfig
    const withProp = {cast: {characters: [{id: 'kael', name: 'Kael', role: 'guitarist', prop: 'an electric guitar'}], locations: []}}

    test('the props step runs only with the setting on and somebody with a prop', () => {
        expect(stepUsed('props', '.', withProp, config(false))).toBe(false)
        expect(stepUsed('props', '.', withProp, config(true))).toBe(true)
        expect(stepUsed('props', '.', {cast: {characters: [{id: 'm', name: 'M', role: 'singer'}], locations: []}}, config(true))).toBe(false)
    })

    test('a project made before counts as off: turning it on builds the props, nothing else', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'props-test-'))
        try {
            const input = (await projectInputs(dir, config(true))).propPictures!
            expect(input).toMatchObject({value: 'true', steps: ['props'], assumed: 'false'})
            expect((await projectInputs(dir, config(false))).propPictures!.value).toBe(input.assumed!)
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })

    test('a changed cast drops the props built from it', () => {
        expect(builtOn(['cast'], {cast: withProp.cast, props: {}})).toContain('props')
    })
})
