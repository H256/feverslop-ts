import {describe, expect, test} from 'bun:test'
import {wan2gpClipSettings, type Wan2gpClipInput} from './wan2gp-clip.ts'

const clip = (more: Partial<Wan2gpClipInput> = {}): Wan2gpClipInput => ({
    template: 'gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps',
    prompt: 'subject_definitions: ...',
    pictures: ['a/singer.png', 'a/place.png'],
    soundtrack: 'cuts/slot-009-sound.wav',
    frames: 121,
    fps: 24,
    seed: 7,
    size: {width: 1344, height: 768},
    ...more,
})

describe("a music-video clip's wan2gp form (#1204, #1214)", () => {
    test("pictures as references in their order, the clip's sound as the soundtrack (AS), the size and length as asked", () => {
        expect(wan2gpClipSettings(clip({startFrame: 'frames/lf.png'}))).toEqual({
            template: 'gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps',
            prompt: 'subject_definitions: ...',
            image_refs: ['a/singer.png', 'a/place.png'],
            video_prompt_type: 'I',
            resolution: '1344x768',
            video_length: 121,
            seed: 7,
            audio_prompt_type: 'AS',
            audio_guide: 'cuts/slot-009-sound.wav',
            image_start: 'frames/lf.png',
            image_prompt_type: 'S',
        })
        expect(wan2gpClipSettings(clip({soundtrack: undefined}))).toMatchObject({audio_prompt_type: ''})
    })
    test('what wan2gp cannot take stays on ComfyUI, with the reason', () => {
        expect(wan2gpClipSettings(clip({pictures: Array(10).fill('p.png')}))).toBe("it has 10 pictures, wan2gp's H3 takes 9")
        expect(wan2gpClipSettings(clip({contextFrames: true}))).toContain('context frames')
    })
    test('a short clip has a wan2gp form too: a soundtrack has no minimum length (an audio reference had 2 s)', () => {
        expect(wan2gpClipSettings(clip({frames: 29}))).toMatchObject({video_length: 29, audio_prompt_type: 'AS'})
    })
})

test('a seed of ours (up to 2^48) becomes one wan2gp takes (up to 2^32 - 1), the same one every time', () => {
    const big = 2 ** 47 + 12345
    const sent = wan2gpClipSettings(clip({seed: big})) as unknown as {seed: number}
    expect(sent.seed).toBe(big % 2 ** 32)
    expect(sent.seed).toBeLessThan(2 ** 32)
})
