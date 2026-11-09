import {expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {filmInputs} from './inputs.ts'
import {filmDefaults} from './config.ts'

test('an explicit default duration changes the coverage fingerprint (#653)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'film-inputs-'))
    try {
        const config = {...filmDefaults, targetDuration: 90, targetDurationSet: false}
        const implicit = await filmInputs(dir, config)
        const explicit = await filmInputs(dir, {...config, targetDurationSet: true})
        expect(explicit.targetDuration!.value).not.toEqual(implicit.targetDuration!.value)
        expect(explicit.targetDuration!.steps).toContain('coverage')
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
