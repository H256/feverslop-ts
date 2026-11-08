import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {assetPaths, copyAsset} from "./asset-import.ts";
import {libraryDir, libraryIds, libraryLayout, libraryRef, readLibraryAsset, withNewLibraryAsset, writeLibraryAsset} from "./library.ts";

const dirs: string[] = []
const folder = (files: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'library-'))
    dirs.push(dir)
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), {recursive: true})
        writeFileSync(join(dir, file), content)
    }
    return dir
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

describe('the library', () => {
    test('a project asset goes in and comes out again into another project, renamed both ways', () => {
        const project = folder({
            'assets/characters/kael.png': 'sheet', 'assets/characters/kael.png.json': '{}',
            'assets/sequence/characters/kael/anchor.png': 'anchor', 'assets/sequence/characters/kael/frames/frame_00.png': 'f0',
        })
        const library = folder()
        copyAsset({dir: project, layout: assetPaths('character', 'kael'), label: 'tides'}, {dir: library, layout: libraryLayout('character', 'kael-red'), archiveName: 'kael-red'})
        writeLibraryAsset(library, {kind: 'character', id: 'kael-red', name: 'Kael', description: 'A weathered man.', source: 'tides/kael'})
        expect(readFileSync(join(library, 'characters/kael-red/picture.png'), 'utf8')).toBe('sheet')
        expect(readFileSync(join(library, 'characters/kael-red/sheet/frames/frame_00.png'), 'utf8')).toBe('f0')

        const next = folder()
        copyAsset({dir: library, layout: libraryLayout('character', 'kael-red'), label: 'library'}, {dir: next, layout: assetPaths('character', 'guitarist'), archiveName: 'guitarist'})
        expect(readFileSync(join(next, 'assets/characters/guitarist.png'), 'utf8')).toBe('sheet')
        expect(readFileSync(join(next, 'assets/sequence/characters/guitarist/anchor.png'), 'utf8')).toBe('anchor')
        // pinned: the picture and the anchor, which a render checks - not the frames
        expect(JSON.parse(readFileSync(join(next, 'assets/sequence/characters/guitarist/anchor.png.json'), 'utf8')).source).toBe('user')
        expect(existsSync(join(next, 'assets/sequence/characters/guitarist/frames/frame_00.png.json'))).toBe(false)
    })
    test('records: read back with kind and id, listed only with their asset.json', async () => {
        const library = folder({'locations/half-done/picture.png': 'x'})
        writeLibraryAsset(library, {kind: 'location', id: 'stage', name: 'Stage', description: 'A stage.', anchors: 'the back wall', layout: {layout: 'wide', views: ['a', 'b', 'c', 'd', 'e']}})
        expect(libraryIds(library, 'location')).toEqual(['stage'])
        expect(await readLibraryAsset(library, 'location', 'stage')).toMatchObject({kind: 'location', id: 'stage', anchors: 'the back wall'})
        expect(await readLibraryAsset(library, 'location', 'half-done')).toBeUndefined()
    })
    test('concurrent writers cannot replace the same library id', async () => {
        const library = folder()
        let writes = 0
        const create = (name: string) => withNewLibraryAsset(library, 'character', 'same-id', async () => {
            writes++
            await Bun.sleep(10)
            writeLibraryAsset(library, {kind: 'character', id: 'same-id', name, description: name})
        })

        const results = await Promise.allSettled([create('first'), create('second')])

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
        expect(writes).toBe(1)
        expect(await readLibraryAsset(library, 'character', 'same-id')).toMatchObject({name: expect.any(String)})
    })
    test('a second process cannot write a library id held by the first process', async () => {
        const library = folder()
        const ready = join(library, 'ready')
        const moduleUrl = new URL('./library.ts', import.meta.url).href
        const script = `
            import {writeFileSync} from 'node:fs'
            import {withNewLibraryAsset, writeLibraryAsset} from ${JSON.stringify(moduleUrl)}
            try {
                await withNewLibraryAsset(${JSON.stringify(library)}, 'character', 'shared-id', async () => {
                    writeFileSync(${JSON.stringify(ready)}, 'locked')
                    await Bun.sleep(500)
                    writeLibraryAsset(${JSON.stringify(library)}, {kind: 'character', id: 'shared-id', name: 'winner', description: 'winner'})
                })
            } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
        `
        const first = Bun.spawn([process.execPath, '-e', script], {cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe'})
        const deadline = Date.now() + 10_000
        while (!existsSync(ready) && Date.now() < deadline) await Bun.sleep(10)
        expect(existsSync(ready)).toBe(true)
        const second = Bun.spawn([process.execPath, '-e', script], {cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe'})
        const exits = await Promise.all([first.exited, second.exited])

        expect(exits.filter(code => code === 0)).toHaveLength(1)
        expect(exits.filter(code => code !== 0)).toHaveLength(1)
        expect(await readLibraryAsset(library, 'character', 'shared-id')).toMatchObject({name: 'winner'})
    })
    test('libraryRef reads "library:<id>", nothing else', () => {
        expect(libraryRef('library:kael-red')).toBe('kael-red')
        expect(libraryRef('project:kael')).toBeUndefined()
        expect(libraryRef(undefined)).toBeUndefined()
    })
    test('FEVERSLOP_LIBRARY wins', async () => {
        const before = process.env.FEVERSLOP_LIBRARY
        process.env.FEVERSLOP_LIBRARY = join(tmpdir(), 'somewhere')
        try {
            expect(await libraryDir()).toBe(join(tmpdir(), 'somewhere'))
        } finally {
            if (before === undefined) delete process.env.FEVERSLOP_LIBRARY
            else process.env.FEVERSLOP_LIBRARY = before
        }
    })
})
