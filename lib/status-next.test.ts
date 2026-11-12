import {expect, test} from 'bun:test'
import {nextOf} from './status.ts'

// #828: the next step, one at a time - and after the pictures one clip first, before the GPU time of all of them
const estimates = {pictures: async (n: number) => `${n} pictures`, clips: async (c: {frames: number}[]) => `${c.length} clip(s)`}
const clip = (id: string) => ({id, frames: 24})
const state = (more: Record<string, unknown>) =>
    ({
        missingPictures: [],
        stalePictures: [],
        pictures: [],
        clips: [clip('slot-001'), clip('slot-002')],
        missingClips: [],
        staleClips: [],
        finalState: 'missing',
        ...more,
    }) as never

test('the next step: the plan, the pictures, one clip first, the rest, the final video', async () => {
    const run = 'bun index.ts demo'
    expect((await nextOf(run, ['story'], state({}), estimates, 'final video')).command).toBe(run)
    expect((await nextOf(run, [], state({missingPictures: [{id: 'ann'}]}), estimates, 'final video')).command).toBe(`${run} --render=images`)
    const first = await nextOf(run, [], state({missingClips: [clip('slot-001'), clip('slot-002')]}), estimates, 'final video')
    expect(first).toEqual({
        command: `${run} --render=videos --only=slot-001`,
        why: 'no clip rendered yet - one first, to look at it before all 2',
        estimate: '1 clip(s)',
    })
    expect((await nextOf(run, [], state({missingClips: [clip('slot-002')]}), estimates, 'final video')).command).toBe(`${run} --render=videos`)
    expect((await nextOf(run, [], state({}), estimates, 'final video')).command).toBe(`${run} --render=final`)
})
