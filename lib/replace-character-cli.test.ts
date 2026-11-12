import {afterAll, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// #827: replace-character runs without a terminal when told everything, and says what is missing when not
const root = mkdtempSync(join(tmpdir(), 'replace-character-'))
afterAll(() => rmSync(root, {recursive: true, force: true}))
const tool = join(import.meta.dir, '..', 'tools', 'replace-character.ts')
const run = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, tool, ...args], {
        cwd: root,
        env: {...process.env, NO_COLOR: '1', FEVERSLOP_SETTINGS: join(root, 'no-settings.json')},
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    return {code: result.exitCode, out: result.stdout.toString() + result.stderr.toString()}
}

test('without a terminal: what is missing is named; a dry run changes nothing', () => {
    const dir = join(root, 'projects', 'demo')
    mkdirSync(join(dir, 'input'), {recursive: true})
    writeFileSync(join(dir, 'input', 'lyrics.txt'), 'la')
    writeFileSync(join(dir, 'project.json'), JSON.stringify({cast: {characters: [{id: 'ann', name: 'Ann', role: 'singer'}], locations: []}}))
    writeFileSync(join(root, 'new.png'), 'not really a picture')
    expect(run('demo').out).toContain('give --character=<id> - ann')
    expect(run('demo', '--character=bob').out).toContain('--character: no "bob" in demo')
    expect(run('demo', '--character=ann').out).toContain('give --picture=<file>')
    expect(run('demo', '--character=ann', '--picture=missing.png').out).toContain('--picture: no file missing.png')
    expect(run('demo', '--character=ann', '--picture=new.png').out).toContain('give --description=vision|keep|<text>')
    const dry = run('demo', '--character=ann', '--picture=new.png', '--description=keep', '--dry-run')
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('Dry run - nothing was changed')
})

test('a film too: what is missing is named, a narrator has no picture, a dry run changes nothing', () => {
    const film = (...args: string[]) => {
        const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '..', 'tools', 'film-replace-character.ts'), ...args], {
            cwd: root,
            env: {...process.env, NO_COLOR: '1', FEVERSLOP_SETTINGS: join(root, 'no-settings.json')},
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        return {code: result.exitCode, out: result.stdout.toString() + result.stderr.toString()}
    }
    const dir = join(root, 'films', 'night')
    mkdirSync(join(dir, 'input'), {recursive: true})
    writeFileSync(join(dir, 'input', 'idea.txt'), 'a lighthouse')
    const cast = {
        characters: [
            {id: 'ann', name: 'Ann', role: 'keeper', appearance: '', voice: '', aliases: []},
            {id: 'voice', name: 'Voice', role: '', appearance: '', voice: '', aliases: [], voiceOnly: true},
        ],
        locations: [],
    }
    writeFileSync(join(dir, 'project.json'), JSON.stringify({cast}))
    writeFileSync(join(root, 'new.png'), 'not really a picture')
    expect(film('night').out).toContain('give --character=<id> - ann')
    expect(film('night', '--character=voice').out).toContain('--character: no "voice" with a picture')
    expect(film('night', '--character=ann', '--picture=new.png').out).toContain('give --description=vision|keep|<text>')
    const dry = film('night', '--character=ann', '--picture=new.png', '--description=keep', '--dry-run')
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('Dry run - nothing was changed')
})
