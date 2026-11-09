import {expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {partialOf, writeJsonFile} from './json-file.ts'

test('a JSON file is replaced whole, and no partial file is left next to it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'json-file-'))
    try {
        const file = join(dir, 'project.json')
        writeFileSync(file, '{"old": true}')
        writeJsonFile(file, {story: 'new'})
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({story: 'new'})
        expect(existsSync(partialOf(file))).toBe(false)
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
})
