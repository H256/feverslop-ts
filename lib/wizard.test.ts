import {afterEach, expect, spyOn, test} from "bun:test";
import * as p from "@clack/prompts";
import {PassThrough} from "node:stream";
import {log} from "./log.ts";
import {answer} from "./wizard.ts";

// what a prompt really returns when it is cancelled
const cancelled = () => p.confirm({message: 'x', signal: AbortSignal.abort(), input: new PassThrough(), output: new PassThrough()})

afterEach(() => {
    spyOn(process, 'exit').mockRestore()
    spyOn(log, 'cancel').mockRestore()
})

async function cancelMessage(ask: (value: unknown) => unknown) {
    const cancel = spyOn(log, 'cancel').mockImplementation(() => {})
    spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
    })
    const value = await cancelled()
    expect(() => ask(value)).toThrow('exit')
    return cancel.mock.calls.at(-1)![0]
}

test('a cancel says nothing was written, unless the tool says what a cancel means for it', async () => {
    expect(await cancelMessage(value => answer(value))).toBe('Cancelled - nothing written')
    expect(await cancelMessage(value => answer(value, 'Cancelled - nothing more saved'))).toBe('Cancelled - nothing more saved')
})

test('an answer comes back as it is', () => {
    expect(answer('a song')).toBe('a song')
    expect(answer(false, 'Cancelled')).toBe(false)
})
