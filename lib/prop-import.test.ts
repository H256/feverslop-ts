import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {writeLibraryAsset} from './library.ts'
import type {Project} from './project.ts'
import {applyPropImport, planPropImport, propImportProblem} from './prop-import.ts'

// a prop of the library for a character's prop (#944)
describe('import-asset prop', () => {
    let dir: string
    let library: string
    const data = (): Project => ({
        cast: {
            characters: [
                {id: 'kael', name: 'Kael', role: 'guitarist', prop: 'an electric guitar', propStem: 'guitar'},
                {id: 'mira', name: 'Mira', role: 'singer'},
            ],
            locations: [],
        },
        props: {kael: {id: 'electric-guitar', name: 'electric guitar', description: 'an electric guitar'}},
    })
    const clip = (id: string, pictures: {kind: string; id: string}[]) => {
        mkdirSync(join(dir, 'output', 'clips'), {recursive: true})
        writeFileSync(join(dir, 'output', 'clips', `${id}.json`), JSON.stringify({assets: {pictures}}))
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'prop-import-'))
        library = mkdtempSync(join(tmpdir(), 'prop-library-'))
        writeLibraryAsset(library, {kind: 'prop', id: 'sunburst-strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster with a white pickguard'})
        writeFileSync(join(library, 'props', 'sunburst-strat', 'picture.png'), 'png')
    })
    afterEach(() => {
        rmSync(dir, {recursive: true, force: true})
        rmSync(library, {recursive: true, force: true})
    })

    test('refused: no such character, one without a prop, a project without prop pictures', () => {
        expect(propImportProblem(data(), true, 'nobody', 'p')).toContain('"nobody" is no character of p: kael, mira')
        expect(propImportProblem(data(), true, 'mira', 'p')).toContain('Mira has no prop')
        expect(propImportProblem(data(), false, 'kael', 'p')).toContain('"propPictures": true')
        expect(propImportProblem(data(), true, 'kael', 'p')).toBeUndefined()
    })

    test('the dry run: the old and the new prop, and the clips that show the character', () => {
        clip('slot-001', [{kind: 'character', id: 'kael'}])
        clip('slot-002', [{kind: 'character', id: 'mira'}])
        mkdirSync(join(dir, 'videos'))
        writeFileSync(join(dir, 'videos', 'slot-001.mp4'), '')
        const plan = planPropImport(dir, data(), 'kael', {kind: 'prop', id: 'sunburst-strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster'})
        expect(plan).toEqual({
            characterId: 'kael',
            characterName: 'Kael',
            old: {id: 'electric-guitar', name: 'electric guitar', description: 'an electric guitar'},
            prop: {id: 'sunburst-strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster'},
            clips: ['slot-001'],
            rendered: ['slot-001'],
        })
    })

    test("the picture is copied pinned and the character's prop is the library's", () => {
        const project = data()
        const plan = planPropImport(dir, project, 'kael', {kind: 'prop', id: 'sunburst-strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster'})
        applyPropImport(dir, project, plan, library, 'sunburst-strat')
        expect(readFileSync(join(dir, 'assets', 'props', 'sunburst-strat.png'), 'utf8')).toBe('png')
        expect(JSON.parse(readFileSync(join(dir, 'assets', 'props', 'sunburst-strat.png.json'), 'utf8')).pinned).toBeTruthy()
        expect(project.props!.kael).toEqual({id: 'sunburst-strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster'})
        expect(existsSync(join(dir, 'assets', 'props', 'electric-guitar.png'))).toBe(false)
    })

    test("an id another character's prop has gets a number", () => {
        const project = data()
        project.cast!.characters.push({id: 'bo', name: 'Bo', role: 'bassist', prop: 'a bass'})
        project.props!.bo = {id: 'sunburst-strat', name: 'x', description: 'x'}
        expect(planPropImport(dir, project, 'kael', {kind: 'prop', id: 'sunburst-strat', name: 's', description: 's'}).prop.id).toBe('sunburst-strat-2')
    })

    test('props not built yet are built from the cast first', () => {
        const project = {...data(), props: undefined}
        const plan = planPropImport(dir, project, 'kael', {kind: 'prop', id: 'sunburst-strat', name: 's', description: 's'})
        expect(plan.old?.id).toBe('electric-guitar')
    })
})
