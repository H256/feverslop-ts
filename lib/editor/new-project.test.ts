import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {filmInitArgs, initArgs, saidWrong} from './new-project.ts'
import {editorHandler} from './server.ts'
import {setupArgs} from './setup-run.ts'
import {songType} from './upload.ts'

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
    test('a change of the servers: only the options of its command, each a line of text', () => {
        expect(setupArgs({command: 'llm', options: {url: 'http://a/v1', model: 'm', key: ''}})).toEqual(['llm', '--url=http://a/v1', '--model=m'])
        expect(setupArgs({command: 'vision', options: {off: true}})).toEqual(['vision', '--off'])
        expect(() => setupArgs({command: 'llm', options: {add: 'x'}})).toThrow('has no option --add')
        expect(() => setupArgs({command: 'comfy', options: {add: 'a\nb'}})).toThrow('a line of text')
        expect(() => setupArgs({command: 'whisper' as 'llm', options: {}})).toThrow('llm, vision or comfy')
    })
    test('a film: its idea or screenplay, the length and language as given', () => {
        expect(filmInitArgs({id: 'night', idea: 'A keeper', length: '90', language: 'de', style: ''})).toEqual([
            'night',
            '--idea=A keeper',
            '--length=90',
            '--language=de',
        ])
        expect(() => filmInitArgs({id: 'night', style: 'noir'})).toThrow('a story idea or a screenplay')
        expect(() => filmInitArgs({id: 'Night'})).toThrow('the id of a film')
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
        expect(JSON.parse(readFileSync(join(root, 'projects', 'rain', 'config.json'), 'utf8'))).toEqual({clipPrompt: 'compact', singers: ['auto']})

        const again = await post({id: 'rain', idea: 'another'})
        expect(again.status).toBe(400)
        expect(((await again.json()) as {error: string}).error).toContain('is there already')

        const wrong = await post({id: 'snow', song: 'missing.wav', lyrics: 'la'})
        expect(wrong.status).toBe(400)
        expect(((await wrong.json()) as {error: string}).error).toBe('--song: no file missing.wav')
        expect(existsSync(join(root, 'projects', 'snow'))).toBe(false)
    }, 60_000)

    // #939: the page cannot say where a chosen file is - it sends the song, and init copies it from where the server put it
    test('a song chosen in the form: sent, taken by what its bytes are, copied into the new project, and its upload gone', async () => {
        const upload = (bytes: Uint8Array, name: string) => {
            const form = new FormData()
            form.set('song', new File([bytes], name))
            return editorHandler()(new Request('http://localhost/api/uploads/song', {method: 'POST', body: form}))
        }
        // a WAV head - RIFF....WAVE - and a little more
        const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4, 5, 6])
        const sent = await upload(wav, 'C:\\fakepath\\my song.mp3')
        expect(sent.status).toBe(200)
        const taken = (await sent.json()) as {file: string; name: string; bytes: number}
        // what the bytes are counts, not the name; the browser's fakepath is never a path here
        expect(taken.file).toEndWith('song.wav')
        expect(taken.file).not.toContain('fakepath')
        expect(taken.bytes).toBe(wav.length)
        expect(readFileSync(taken.file)).toEqual(Buffer.from(wav))

        const made = await post({id: 'sent-song', song: taken.file, lyrics: 'la la'})
        expect(await made.json()).toEqual({id: 'sent-song'})
        expect(readFileSync(join(root, 'projects', 'sent-song', 'input', 'song.wav'))).toEqual(Buffer.from(wav))
        expect(existsSync(taken.file)).toBe(false)

        const notASong = await upload(new TextEncoder().encode('just words'), 'song.wav')
        expect(notASong.status).toBe(400)
        expect(((await notASong.json()) as {error: string}).error).toBe('not a song: a WAV, a FLAC or an MP3 is taken')
        const none = await editorHandler()(new Request('http://localhost/api/uploads/song', {method: 'POST', body: new FormData()}))
        expect(none.status).toBe(400)
    }, 60_000)

    test('the servers of the machine: read as setup show --json, changed by the command (#831)', async () => {
        const handler = editorHandler()
        const change = (body: unknown) => handler(new Request('http://localhost/api/setup', {method: 'POST', body: JSON.stringify(body)}))
        const added = await change({command: 'comfy', options: {add: 'gpu1.lan:8188', name: 'gpu1'}})
        expect(((await added.json()) as {said: string[]}).said[0]).toContain('Added gpu1')
        const view = (await (await handler(new Request('http://localhost/api/setup'))).json()) as {comfy: {name: string; url: string}[]}
        expect(view.comfy).toEqual([{name: 'gpu1', url: 'http://gpu1.lan:8188'}])
        const wrong = await change({command: 'comfy', options: {remove: 'gpu9'}})
        expect(wrong.status).toBe(400)
        expect(((await wrong.json()) as {error: string}).error).toContain('no server "gpu9"')
    })
    test('a new film is written by film:init, with the form as its options (#831)', async () => {
        const made = await editorHandler()(
            new Request('http://localhost/api/films/new', {method: 'POST', body: JSON.stringify({id: 'night', idea: 'A lighthouse keeper', length: '60'})}),
        )
        expect(await made.json()).toEqual({id: 'night'})
        expect(readFileSync(join(root, 'films', 'night', 'input', 'idea.txt'), 'utf8')).toBe('A lighthouse keeper')
        expect(JSON.parse(readFileSync(join(root, 'films', 'night', 'config.json'), 'utf8'))).toEqual({targetDuration: 60})
        const wrong = await editorHandler()(
            new Request('http://localhost/api/films/new', {method: 'POST', body: JSON.stringify({id: 'other', idea: 'x', length: '5'})}),
        )
        expect(wrong.status).toBe(400)
        expect(((await wrong.json()) as {error: string}).error).toContain('--length: at least 10 seconds')
    })
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

describe('what a sent song is, by its first bytes (#939)', () => {
    test('a WAV, a FLAC, an MP3 with a tag or a frame header - nothing else', () => {
        const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array<number>(12).fill(0)])
        expect(songType(bytes(0x66, 0x4c, 0x61, 0x43))).toBe('flac')
        expect(songType(bytes(0x49, 0x44, 0x33, 4))).toBe('mp3')
        expect(songType(bytes(0xff, 0xfb, 0x90))).toBe('mp3')
        // an MPEG frame of another layer, a PNG, words
        expect(songType(bytes(0xff, 0xfd))).toBeUndefined()
        expect(songType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeUndefined()
        expect(songType(new TextEncoder().encode('RIFF but no wave'))).toBeUndefined()
    })
})
