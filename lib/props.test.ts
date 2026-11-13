import {describe, expect, test} from 'bun:test'
import {defaults, type ProjectConfig} from './config.ts'
import {projectInputs, stepUsed} from './inputs.ts'
import {builtOn} from './project.ts'
import {asDrawn, castProps, propName, propPictureJob, propsOfPlace, withArticle} from './props.ts'
import {characterLookPrompt} from './prompts.ts'
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

    test('a project made before counts as off: turning it on builds the props and draws the looks again', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'props-test-'))
        try {
            const input = (await projectInputs(dir, config(true))).propPictures!
            expect(input).toMatchObject({value: 'true', steps: ['props', 'characterLooks', 'locationLooks'], assumed: 'false'})
            expect((await projectInputs(dir, config(false))).propPictures!.value).toBe(input.assumed!)
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })

    test('a changed cast drops the props built from it', () => {
        expect(builtOn(['cast'], {cast: withProp.cast, props: {}})).toContain('props')
    })
})

describe('the picture of a prop (#944)', () => {
    test('one plain picture in assets/props, drawn alone on the grey backdrop', () => {
        const job = propPictureJob({id: 'electric-guitar', name: 'electric guitar', description: 'an electric guitar'})
        expect(job).toMatchObject({kind: 'prop', id: 'electric-guitar', file: 'assets/props/electric-guitar.png', name: 'electric guitar'})
        expect(job.prompt).toStartWith('A studio product photograph of an electric guitar. The electric guitar alone')
        expect(job.prompt).toContain('no hands, no people')
    })
})

describe('the look without the prop (#944)', () => {
    const guitarist = {name: 'Kael', role: 'guitarist', prop: 'an electric guitar'}
    const drummer = {name: 'Veyra', role: 'drummer', prop: 'a drum kit', propCarried: false as const, propInHand: 'drumsticks'}

    test('with the setting the character is drawn with nothing in the hands, and the prop is not in the character JSON', () => {
        for (const char of [guitarist, drummer]) {
            const prompt = characterLookPrompt('a look', asDrawn(char, true)).input as string
            expect(prompt).toContain(`- The character's "${char.prop}" has a picture of its own and is not in this one: nothing is in their hands`)
            expect(prompt).not.toContain('"prop"')
            expect(prompt).not.toContain('"inHand"')
            expect(prompt).not.toContain('It is in use in the picture')
        }
    })

    test('without it the look shows the prop in use, as before', () => {
        const prompt = characterLookPrompt('a look', asDrawn(guitarist, false)).input as string
        expect(prompt).toContain('It is in use in the picture')
        expect(prompt).toContain('"prop":"an electric guitar"')
    })
})

describe('the place without the prop (#944)', () => {
    const band = [{prop: 'an electric guitar'}, {prop: 'a drum kit', propCarried: false as const, propPlace: 'stage'}]
    test('without the setting the drum kit stands in its place, drawn into it', () => {
        expect(propsOfPlace(band, 'stage', false)).toEqual({kept: ['an electric guitar'], standing: ['a drum kit']})
        expect(propsOfPlace(band, 'street', false)).toEqual({kept: ['an electric guitar'], standing: []})
    })
    test('with it the place is drawn without any prop: the kit comes with its player', () => {
        expect(propsOfPlace(band, 'stage', true)).toEqual({kept: ['an electric guitar', 'a drum kit'], standing: []})
    })
})

test('the picture of a prop whose words have no article gets one (#944)', () => {
    expect(propPictureJob({id: 'electric-guitar', name: 'electric guitar', description: 'electric guitar'}).prompt).toStartWith(
        'A studio product photograph of an electric guitar. The electric guitar alone',
    )
    expect(withArticle('obsidian drum kit')).toBe('an obsidian drum kit')
    expect(withArticle('two drumsticks')).toBe('two drumsticks')
    expect(withArticle('her bass')).toBe('her bass')
    expect(withArticle('bass guitar')).toBe('a bass guitar')
})
