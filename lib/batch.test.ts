import {expect, test} from "bun:test";
import {renderAll} from "./batch.ts";

test('the failure names each failed render by the first line of its error', async () => {
    const failing = (message: string) => () => Promise.reject(new Error(message))
    const items = [failing('clip slot-001: out of memory\nTIPS: a long tip'), failing('clip slot-002: gone'), () => Promise.resolve()]
    const message = await renderAll(items, item => item()).catch((e: Error) => e.message)
    expect(message).toContain('2 of 3 renders failed')
    expect(message).toContain('clip slot-001: out of memory')
    expect(message).toContain('clip slot-002: gone')
    expect(message).not.toContain('TIPS')
})
