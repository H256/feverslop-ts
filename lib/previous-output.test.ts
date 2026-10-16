import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PREVIOUS, requestChanges, startOutput} from "./previous-output.ts";

let dir: string
afterEach(() => rmSync(dir, {recursive: true, force: true}))

const write = (output: string, clips: Record<string, string>) => {
    mkdirSync(join(output, 'clips'), {recursive: true})
    for (const [id, text] of Object.entries(clips)) writeFileSync(join(output, 'clips', `${id}.json`), text)
}

describe('the output of the run before', () => {
    test('the first run has nothing to compare with', () => {
        dir = mkdtempSync(join(tmpdir(), 'fs-output-'))
        const output = join(dir, 'output')
        startOutput(output)
        write(output, {'slot-001': 'a'})
        expect(requestChanges(output)).toBeUndefined()
    })

    test('changed, new and gone requests; one generation only', () => {
        dir = mkdtempSync(join(tmpdir(), 'fs-output-'))
        const output = join(dir, 'output')
        startOutput(output)
        write(output, {'slot-001': 'a', 'slot-002': 'b', 'slot-003': 'c'})
        startOutput(output)
        expect(existsSync(join(output, PREVIOUS, 'clips', 'slot-001.json'))).toBe(true)
        expect(existsSync(join(output, 'clips'))).toBe(false)
        write(output, {'slot-001': 'a', 'slot-002': 'B', 'slot-004': 'd'})
        expect(requestChanges(output)).toEqual({changed: ['slot-002'], added: ['slot-004'], gone: ['slot-003']})
        startOutput(output)
        expect(existsSync(join(output, PREVIOUS, PREVIOUS))).toBe(false)
        expect(existsSync(join(output, PREVIOUS, 'clips', 'slot-004.json'))).toBe(true)
    })
})
