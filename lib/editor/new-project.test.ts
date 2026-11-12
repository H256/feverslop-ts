import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {initArgs, saidWrong} from './new-project.ts'
import {editorHandler} from './server.ts'

// #831: a new music video from the start page is `bun run init` with the form as its options - the same command as in the terminal.
describe('the arguments of init from the form', () => {
    test('each field its option, empty ones left out, the texts as they are', () => {
        expect(
            initArgs({id: 'rain', idea: 'A song about rain', storyIdea: 'A walk\nat night', singers: 'auto', language: 'de', style: '', lyrics: undefined}),
        ).toEqual(['rain', '--idea=A song about rain', '--story-idea=A walk\nat night', '--singers=auto', '--language=de'])
        expect(initArgs({id: 'rain', song: '  D:\\music\\song.mp3 ', lyrics: 'la la'})).toEqual(['rain', '--song=D:\\music\\song.mp3', '--lyrics=la la'])
    })
    test('a song of the library is its id (#835)', () => {
        expect(initArgs({id: 'rain', librarySong: 'well-of-youth'})).toEqual(['rain', '--library-song=well-of-youth'])
    })
    test('no usable id, nothing to make it from, a value that is no text', () => {
        expect(() => initArgs({id: '../etc'})).toThrow('the id of a project')
        expect(() => initArgs({id: 'Rain Song', idea: 'x'})).toThrow('the id of a project')
        expect(() => initArgs({id: 'rain'})).toThrow('a song with its lyrics or a story idea')
        expect(() => initArgs({id: 'rain', idea: 5 as unknown as string})).toThrow('idea: a text')
    })
    test('what the command said was wrong is the line under its heading', () => {
        expect(saidWrong('INIT · rain\n✗ BAD USAGE\n--song: no file nope.wav\nHelp: bun run init --help')).toBe('--song: no file nope.wav')
        expect(saidWrong('')).toBe('the project could not be created')
    })
})

describe('the routes of the start page', () => {
    const here = process.cwd()
    const before = {...process.env}
    let root: string
    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'new-project-'))
        process.chdir(root)
        process.env.FEVERSLOP_SETTINGS = join(root, 'no-settings.json')
        process.env.FEVERSLOP_LIBRARY = join(root, 'library')
    })
    afterAll(() => {
        process.chdir(here)
        for (const name of ['FEVERSLOP_SETTINGS', 'FEVERSLOP_LIBRARY']) {
            if (before[name] === undefined) delete process.env[name]
            else process.env[name] = before[name]
        }
        rmSync(root, {recursive: true, force: true})
    })
    const post = (body: unknown) => editorHandler()(new Request('http://localhost/api/projects/new', {method: 'POST', body: JSON.stringify(body)}))

    test('a new project is written by the command, and a second one of its id refused in the command’s words', async () => {
        const made = await post({id: 'rain', idea: 'A song about rain', singers: 'auto'})
        expect(await made.json()).toEqual({id: 'rain'})
        expect(readFileSync(join(root, 'projects', 'rain', 'input', 'idea.txt'), 'utf8')).toBe('A song about rain')
        expect(JSON.parse(readFileSync(join(root, 'projects', 'rain', 'config.json'), 'utf8'))).toEqual({singers: ['auto']})

        const again = await post({id: 'rain', idea: 'another'})
        expect(again.status).toBe(400)
        expect(((await again.json()) as {error: string}).error).toContain('is there already')

        const wrong = await post({id: 'snow', song: 'missing.wav', lyrics: 'la'})
        expect(wrong.status).toBe(400)
        expect(((await wrong.json()) as {error: string}).error).toBe('--song: no file missing.wav')
        expect(existsSync(join(root, 'projects', 'snow'))).toBe(false)
    }, 60_000)

    test('a page of another site cannot create one', async () => {
        const response = await editorHandler()(
            new Request('http://localhost/api/projects/new', {
                method: 'POST',
                headers: {origin: 'http://evil.example'},
                body: JSON.stringify({id: 'x', idea: 'y'}),
            }),
        )
        expect(response.status).toBe(403)
    })

    test('the machine as the doctor sees it: each line with its state, and a fix where one is missing', async () => {
        const response = await editorHandler()(new Request('http://localhost/api/doctor'))
        const {checks} = (await response.json()) as {checks: {what: string; state: string; fix?: string}[]}
        expect(checks.find(check => check.what === 'LLM server')).toMatchObject({state: 'missing', fix: 'bun run setup llm'})
        expect(checks.map(check => check.what)).toContain('ffmpeg')
    }, 30_000)
})
