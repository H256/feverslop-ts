import {afterAll, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {filmInitOptions} from './init-options.ts'

// #827: a film made by options, nothing asked - for a script and for the workspace
const root = mkdtempSync(join(tmpdir(), 'film-init-'))
afterAll(() => rmSync(root, {recursive: true, force: true}))
const wrong = (argv: string[]) =>
    filmInitOptions(argv).then(
        () => 'no error',
        (e: unknown) => (e as Error).message,
    )

test('none of the options: the wizard asks', async () => {
    expect(await filmInitOptions([])).toBeUndefined()
    expect(await filmInitOptions(['my-film'])).toBeUndefined()
})

test('what is missing or wrong is said in the words of the options', async () => {
    expect(await wrong(['--idea=a lighthouse'])).toContain('the film id comes first')
    expect(await wrong(['f', '--style=noir'])).toBe('a story idea (--idea) or a screenplay (--screenplay)')
    expect(await wrong(['f', '--idea=x', '--screenplay=y'])).toContain('not both')
    expect(await wrong(['f', '--idea=x', '--length=5'])).toContain('--length: at least 10 seconds, or -1')
    expect(await wrong(['f', '--screenplay=y', '--length=-1'])).toContain('--length: at least 10 seconds, got')
    expect(await wrong(['f', '--screenplay=y', '--language=de'])).toContain('--language goes with --idea')
    expect(await wrong(['f', '--idea=x', '--language=klingon'])).toContain('--language')
    expect(await filmInitOptions(['f', '--idea=A lighthouse keeper', '--length=90', '--language=auto', '--style=noir'])).toEqual({
        id: 'f',
        seed: {idea: 'A lighthouse keeper', style: 'noir', config: {targetDuration: 90, dialogueLanguage: 'auto'}},
    })
})

test('with no terminal and all it needs given, the film is written and the next command said', () => {
    writeFileSync(join(root, 'script.txt'), 'INT. HALL - NIGHT\nAna waits.\n')
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '..', '..', 'tools', 'film-init.ts'), 'night', '--screenplay=script.txt'], {
        cwd: root,
        env: {...process.env, NO_COLOR: '1', FEVERSLOP_SETTINGS: join(root, 'no-settings.json')},
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    expect(result.stdout.toString() + result.stderr.toString()).toContain('bun film.ts night')
    expect(result.exitCode).toBe(0)
    expect(readFileSync(join(root, 'films', 'night', 'input', 'screenplay.txt'), 'utf8')).toBe('INT. HALL - NIGHT\nAna waits.')
    expect(existsSync(join(root, 'films', 'night', 'input', 'idea.txt'))).toBe(false)
})
