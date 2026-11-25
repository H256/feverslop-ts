import {describe, expect, test} from 'bun:test'
import {wan2gpClipSettings, type Wan2gpClipInput} from './wan2gp-clip.ts'

const clip = (more: Partial<Wan2gpClipInput> = {}): Wan2gpClipInput => ({
    template: 'gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps',
    prompt: 'subject_definitions: ...',
    pictures: ['a/place.png', 'a/singer.png'],
    audios: ['cuts/vocals.wav'],
    frames: 121,
    fps: 24,
    seed: 7,
    size: {width: 1344, height: 768},
    ...more,
})

describe("a music-video clip's wan2gp form (#1204)", () => {
    test('pictures as references in their order, the stems as audio references, the size and length as asked', () => {
        expect(wan2gpClipSettings(clip({audios: ['cuts/drums.wav', 'cuts/vocals.wav'], startFrame: 'frames/lf.png'}))).toEqual({
            template: 'gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps',
            prompt: 'subject_definitions: ...',
            image_refs: ['a/place.png', 'a/singer.png'],
            video_prompt_type: 'I',
            resolution: '1344x768',
            video_length: 121,
            seed: 7,
            audio_prompt_type: 'AB',
            audio_guide: 'cuts/drums.wav',
            audio_guide2: 'cuts/vocals.wav',
            image_start: 'frames/lf.png',
            image_prompt_type: 'S',
        })
        expect(wan2gpClipSettings(clip({audios: []}))).toMatchObject({audio_prompt_type: ''})
        expect(wan2gpClipSettings(clip({audios: ['1', '2', '3']}))).toMatchObject({audio_prompt_type: 'ABD', audio_guide3: '3'})
    })
    test('what wan2gp cannot take stays on ComfyUI, with the reason', () => {
        expect(wan2gpClipSettings(clip({audios: ['1', '2', '3', '4']}))).toBe("it has 4 audio references, wan2gp's H3 takes 3")
        expect(wan2gpClipSettings(clip({pictures: Array(10).fill('p.png')}))).toBe("it has 10 pictures, wan2gp's H3 takes 9")
        expect(wan2gpClipSettings(clip({frames: 40}))).toContain('wan2gp takes an audio reference of 2 s or more')
        expect(wan2gpClipSettings(clip({contextFrames: true}))).toContain('context frames')
    })
})
