import {afterEach, expect, spyOn, test} from "bun:test";
import * as p from "@clack/prompts";
import {PassThrough} from "node:stream";
import {log} from "./log.ts";
import {answer, projectWorkflows} from "./wizard.ts";

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

const bundled = ['frame-interpolate', 'h3-latent-upscale', 'h3-ref2video', 'h3-ref2video-2pass', 'h3-ref2video-film', 'h3-ref2video-film-2pass', 'h3-refine', 'h3-sequence-to-sheet', 'krea2-image', 'kroma-image', 'video-upscale', 'yue2-song']
test('projectWorkflows: the bundled ones come out as before', () => {
    expect(projectWorkflows(bundled, 'image')).toEqual(['krea2-image', 'kroma-image'])
    expect(projectWorkflows(bundled, 'video')).toEqual(['h3-ref2video', 'h3-ref2video-2pass'])
})
test('projectWorkflows: a workflow of your own is offered whatever it is called', () => {
    const mine = [...bundled, 'my-flux-video', 'my-flux-image', 'flux-schnell']
    expect(projectWorkflows(mine, 'video')).toContain('my-flux-video')
    expect(projectWorkflows(mine, 'image')).toEqual(expect.arrayContaining(['my-flux-image', 'flux-schnell']))
})
