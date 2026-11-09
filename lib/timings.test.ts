import {afterEach, beforeEach, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename, dirname, join} from 'node:path'
import {currentStep, keepTimingsIn, migrateProjectTimings, readTimings, recordTiming, timingsFile, withStep} from './timings.ts'

let dir: string
let originalSettings: string | undefined
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'timings-'))
    originalSettings = process.env.FEVERSLOP_SETTINGS
    process.env.FEVERSLOP_TIMINGS = join(dir, 'central', 'timings.jsonl')
})
afterEach(() => {
    keepTimingsIn(undefined)
    delete process.env.FEVERSLOP_TIMINGS
    if (originalSettings === undefined) delete process.env.FEVERSLOP_SETTINGS
    else process.env.FEVERSLOP_SETTINGS = originalSettings
})

test('measurements go to the one central file, with their project', () => {
    const project = join(dir, 'projects', 'dwarfs')
    keepTimingsIn(project)
    recordTiming({kind: 'clip', name: 'wan', seconds: 12.5, variant: 'abc', frames: 97, pixels: 921600, server: 'gpu1'})
    recordTiming({kind: 'llm', name: 'm', seconds: 3, tokensPerSecond: 40, promptTokens: 100, completionTokens: 120})
    const read = readTimings()
    expect(read.map(t => t.kind)).toEqual(['clip', 'llm'])
    expect(read[0]).toMatchObject({v: 2, project: 'dwarfs', seconds: 12.5, variant: 'abc', server: 'gpu1'})
})

test('nothing is written before a project is set', () => {
    recordTiming({kind: 'clip', name: 'x', seconds: 1})
    expect(existsSync(timingsFile())).toBe(false)
})

test('damaged lines are skipped when reading', () => {
    keepTimingsIn(join(dir, 'p'))
    recordTiming({kind: 'clip', name: 'wan', seconds: 1})
    writeFileSync(timingsFile(), 'garbage\n', {flag: 'a'})
    expect(readTimings()).toHaveLength(1)
})

test('the per-project file of the first format is moved into the central one, not lost', () => {
    const project = join(dir, 'projects', 'old')
    Bun.write(
        join(project, 'timings.jsonl'),
        '{"at":"2026-10-16T10:00:00.000Z","kind":"clip","name":"wan","seconds":90,"resolution":720,"frames":97}\n{"at":"2026-10-16T11:00:00.000Z","kind":"llm","name":"m","seconds":4,"tokensPerSecond":30}\n',
    )
    return Bun.sleep(20).then(() => {
        expect(migrateProjectTimings(project)).toBe(2)
        const read = readTimings()
        expect(read.map(t => [t.project, t.kind, t.seconds])).toEqual([
            ['old', 'clip', 90],
            ['old', 'llm', 4],
        ])
        expect(read[0]!.v).toBeUndefined()
        expect(existsSync(join(project, 'timings.jsonl'))).toBe(false)
        expect(migrateProjectTimings(project)).toBe(0)
    })
})

test('the step of an LLM call is the one it runs in', async () => {
    expect(currentStep()).toBeUndefined()
    await withStep('story', async () => {
        await Bun.sleep(1)
        expect(currentStep()).toBe('story')
    })
})

test('failed migration preserves the source and can be retried (#668)', () => {
    const legacy = join(dir, 'timings.jsonl')
    writeFileSync(legacy, '{"at":"2026-01-01","kind":"clip","name":"w","seconds":12}\n')
    // A directory at the destination makes appending fail on every platform.
    mkdirSync(timingsFile(), {recursive: true})
    expect(migrateProjectTimings(dir)).toBe(0)
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(`${legacy}.migrated`)).toBe(false)
    rmSync(timingsFile(), {recursive: true})
    expect(migrateProjectTimings(dir)).toBe(1)
    expect(readTimings()).toHaveLength(1)
})

test('unchanged timings reuse parsed rows; appends invalidate the cache (#667)', () => {
    keepTimingsIn(join(dir, 'p'))
    recordTiming({kind: 'clip', name: 'w', seconds: 12})
    const first = readTimings()
    expect(readTimings()[0]).toBe(first[0])
    recordTiming({kind: 'clip', name: 'w', seconds: 15})
    expect(readTimings()).toHaveLength(2)
})

test('the default store uses monthly shards and prunes history beyond its retention window (#667)', () => {
    delete process.env.FEVERSLOP_TIMINGS
    process.env.FEVERSLOP_SETTINGS = join(dir, 'settings', 'settings.json')
    const file = timingsFile()
    expect(basename(file)).toMatch(/^timings-\d{4}-\d{2}\.jsonl$/)
    mkdirSync(dirname(file), {recursive: true})
    const old = join(dirname(file), 'timings-2000-01.jsonl')
    writeFileSync(old, '{"at":"2000-01-01","kind":"clip","name":"old","seconds":1}\n')
    keepTimingsIn(join(dir, 'p'))
    recordTiming({kind: 'clip', name: 'new', seconds: 2})
    expect(existsSync(old)).toBe(false)
    expect(readTimings().map(t => t.name)).toEqual(['new'])
})
