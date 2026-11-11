import {describe, expect, test} from 'bun:test'
import {explainFailure, failureAdvice} from './failure-help.ts'

// #819: the failures users met in the logs of real projects - each gets what it means and what to do.
describe('what to do about a failure', () => {
    test.each([
        ['The operation timed out.', 'took too long'],
        ["EPERM: operation not permitted, rename 'projects\\x\\output' -> 'projects\\x\\output.previous'", 'held open'],
        ["EBUSY: resource busy or locked, rename 'a' -> 'b'", 'held open'],
        ['{"message":"","type":"InternalServerError","param":null,"code":500}', 'error of its own'],
        ['LLM http://llm/v1, beats: HTTP 502 Bad Gateway', 'error of its own'],
        ['clip slot-018: ComfyUI job failed in MinimaxH3LatentUpscaler2D - HIP out of memory. Tried to allocate 2.5 GiB.', 'out of memory'],
        ['LLM http://llm/v1, beats: LLM did not answer with valid JSON: Expecting value: line 1 column 1 (char 0)', 'usable answer'],
        ['the model gave no answer in 3 attempts, it only thought', 'usable answer'],
    ])('%s', (failure, means) => {
        const advice = failureAdvice(failure)
        expect(advice).toContain(means)
        // what it means, then what to do: more than a restating of the failure
        expect(advice!.length).toBeGreaterThan(60)
        expect(explainFailure(failure)?.action).toBeTruthy()
    })

    test('a message of this program that says what to do itself gets nothing under it in the terminal', () => {
        for (const failure of [
            'No ComfyUI server reachable (http://x:8188) - start ComfyUI, or check the servers with: bun run setup comfy',
            'The LLM server http://x/v1 does not answer (ECONNREFUSED) - start it …',
            'Direction needs review: bun run direction x --preview, then --take',
            'casting.json: character "a" is "library:b", but the library has no character "b"',
        ]) {
            expect(failureAdvice(failure)).toBeUndefined()
            // the workspace still explains it
            expect(explainFailure(failure)).toBeDefined()
        }
    })

    test('the direction is explained in the words of its page', () => {
        const explained = explainFailure('Direction needs review: …')
        expect(explained?.page).toBe('direction')
        expect(explained?.action).not.toContain('rebind')
    })

    test('an unknown failure stays as it is', () => {
        expect(failureAdvice('ffmpeg could not cut this')).toBeUndefined()
        expect(explainFailure('ffmpeg could not cut this')).toBeUndefined()
    })
})
