import {afterAll, expect, test} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resumeOrQueue} from './servers.ts'

const dir = mkdtempSync(join(tmpdir(), 'uploads-'))
afterAll(() => rmSync(dir, {recursive: true, force: true}))

/** A server that only counts what it is sent, and a renderer with the one field the upload reads. */
function fixture() {
    const sent: string[] = []
    const server = {
        name: 'gpu1',
        url: 'http://gpu1',
        api: {
            uploadImage: async (_file: unknown, name: string, options: {subfolder: string}) => {
                sent.push(`${options.subfolder}/${name}`)
                return {info: {name}}
            },
            queuePrompt: async () => ({prompt_id: `p${sent.length}`}),
        },
    }
    const r = {uploaded: new Map<string, string>(), lastModels: new Map<string, string>(), jobState: async () => 'gone'}
    const prepare = (uploads: {from: string; to: string}[]) => async () => ({
        result: {workflow: {build: () => ({workflow: {}})}, output: 'out'},
        uploads,
        meta: {},
    })
    const run = (uploads: {from: string; to: string}[]) => resumeOrQueue(r as never, 'clip', server as never, join(dir, 'pending.json'), undefined, prepare(uploads) as never)
    return {sent, run}
}

test('the song and the stems of a clip are sent once to a server, not again for the next clip (#979)', async () => {
    const song = join(dir, 'song.wav')
    writeFileSync(song, 'audio-1')
    const {sent, run} = fixture()
    await run([{from: song, to: 'feverslop/song.wav'}])
    await run([{from: song, to: 'feverslop/song.wav'}])
    expect(sent).toEqual(['feverslop/song.wav'])
    // the file changed: sent again
    writeFileSync(song, 'audio-2-longer')
    await run([{from: song, to: 'feverslop/song.wav'}])
    expect(sent).toEqual(['feverslop/song.wav', 'feverslop/song.wav'])
})
