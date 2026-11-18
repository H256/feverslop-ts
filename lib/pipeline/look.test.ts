import {afterEach, expect, spyOn, test} from 'bun:test'
import * as llm from '../llm.ts'
import type {LibraryAsset} from '../library.ts'
import type {Character, Location, Project, ProjectStore} from '../project.ts'
import {planLook} from './look.ts'

afterEach(() => {
    spyOn(llm, 'ask').mockRestore()
    spyOn(llm, 'askJson').mockRestore()
})

// a store that runs every step: nothing is cached, nothing is written
const store = (data: Project = {}) =>
    ({
        id: 'look-test',
        file: 'projects/look-test/project.json',
        data,
        generated: new Set(),
        step: async (name: keyof Project, _title: string, run: () => Promise<unknown>) => (data[name] ??= (await run()) as never),
        each: (_name: string, _key: string, _input: unknown, run: () => Promise<unknown>) => run(),
        save: async () => {},
    }) as unknown as ProjectStore

const character = (id: string): Character => ({id, name: id, role: 'singer'}) as Character
const location = (id: string): Location => ({id, name: id}) as Location
const asset = (more: Partial<LibraryAsset>): LibraryAsset => ({kind: 'location', id: 'lib', name: 'lib', description: 'the library hall', ...more})

// #1156: the per-character and per-place steps ask once per entity - a place the casting took from the library is never asked
test('a place from the library keeps its texts and is not asked; the others are asked per step', async () => {
    const asked: string[] = []
    spyOn(llm, 'ask').mockImplementation(async options => {
        asked.push(options.instructions.slice(0, 40))
        return 'asked text'
    })
    spyOn(llm, 'askJson').mockImplementation(async () => ({layout: 'a long room', views: ['door', 'stage'], set: {stage: ''}}) as never)
    const castLibrary = new Map([['location:hall', asset({anchors: 'red curtains', layout: {layout: 'the library plan', views: ['a', 'b']}})]])
    const look = await planLook({
        project: store(),
        args: {review: false},
        style: '',
        storySummary: 'a band plays',
        cast: {characters: [character('ann')], locations: [location('hall'), location('street')]},
        castLibrary,
        propPictures: false,
    })
    expect(look.locationLooks).toEqual({hall: 'the library hall', street: 'asked text'})
    expect(look.locationDescriptions).toEqual({hall: 'the library hall', street: 'asked text'})
    expect(look.locationAnchors).toEqual({hall: 'red curtains', street: 'asked text'})
    expect(look.locationLayouts.hall).toEqual({layout: 'the library plan', views: ['a', 'b']})
    expect(look.locationLayouts.street?.layout).toBe('a long room')
    expect(look.characterDescriptions).toEqual({ann: 'asked text'})
    // the brief, ann's look and description, street's look, description and anchors
    expect(asked).toHaveLength(6)
})

test('a library text that changed since replaces the one a kept step has', async () => {
    spyOn(llm, 'ask').mockImplementation(async () => 'asked text')
    spyOn(llm, 'askJson').mockImplementation(async () => ({layout: 'x', views: []}) as never)
    const project = store({locationDescriptions: {hall: 'an old description'}})
    const look = await planLook({
        project,
        args: {review: false},
        style: '',
        storySummary: '',
        cast: {characters: [], locations: [location('hall')]},
        castLibrary: new Map([['location:hall', asset({description: 'the new library hall'})]]),
        propPictures: false,
    })
    expect(look.locationDescriptions).toEqual({hall: 'the new library hall'})
})
