import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PREVIOUS, requestChanges, startOutput, whileHeld} from "./previous-output.ts";

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

describe('a folder held open by another program', () => {
    const held = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), {code})
    // whileHeld with a fake action that fails `times` times, and no real waiting
    const run = (times: number, code = 'EPERM') => {
        let calls = 0
        const slept: number[] = []
        const action = () => {
            calls++
            if (calls <= times) throw held(code)
        }
        const result = () => whileHeld('projects/p/output', action, [10, 20, 40], ms => slept.push(ms))
        return {result, calls: () => calls, slept}
    }

    test('let go within the waits: moved, after waiting', () => {
        const {result, calls, slept} = run(2)
        result()
        expect(calls()).toBe(3)
        expect(slept).toEqual([10, 20])
    })
    test('EBUSY is waited for, too', () => {
        const {result, calls} = run(1, 'EBUSY')
        result()
        expect(calls()).toBe(2)
    })
    test('still held after all waits: stops with what to do', () => {
        const {result, calls} = run(10)
        expect(result).toThrow(/projects\/p\/output is held open by another program \(EPERM.*close what has it or a file in it open.*run the same command again/)
        expect(calls()).toBe(4)
    })
    test('another error is not waited for', () => {
        const {result, calls, slept} = run(1, 'ENOENT')
        expect(result).toThrow(/ENOENT/)
        expect(calls()).toBe(1)
        expect(slept).toEqual([])
    })
})
