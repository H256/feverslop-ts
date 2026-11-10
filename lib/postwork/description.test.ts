import {afterEach, describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Timing} from '../timings.ts'
import {POSTWORK_DEFAULTS, postworkProblem} from './config.ts'
import {DEFAULT_ABOUT, descriptionText, duration, factsFor, phaseTimes, publishableVideos, storySource, storyTitle, variantSteps} from './description.ts'
import {finalParts} from './video.ts'

const t = (kind: Timing['kind'], seconds: number, extra: Partial<Timing> = {}): Timing => ({
    at: '2026-11-10T10:00:00Z',
    project: 'p',
    kind,
    name: 'w',
    seconds,
    ...extra,
})

let dirs: string[] = []
const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), 'description-'))
    dirs.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of dirs) rmSync(dir, {recursive: true, force: true})
    dirs = []
})

describe('phaseTimes', () => {
    test('sums the jobs per phase, failed attempts apart, resumed ones and other projects left out', () => {
        const times = phaseTimes(
            [
                t('llm', 60),
                t('llm', 30),
                t('clip', 600),
                t('clip', 400, {outcome: 'again'}),
                t('clip', 100, {outcome: 'failed'}),
                t('clip', 50, {outcome: 'retry'}),
                t('clip', 999, {outcome: 'resumed'}),
                t('clip', 5000, {project: 'other'}),
            ],
            'p',
        )
        expect(times).toEqual([
            {what: 'Planning (language model)', seconds: 90, jobs: 2, failedSeconds: 0, failed: 0},
            {what: 'Clips', seconds: 1000, jobs: 2, failedSeconds: 150, failed: 2},
        ])
    })
})

test('duration', () => {
    expect(duration(45)).toBe('45 s')
    expect(duration(720)).toBe('12 min')
    expect(duration(14 * 3600 + 3 * 60)).toBe('14 h 03 min')
})

describe('the chosen video', () => {
    test('its name says what it went through', () => {
        expect(variantSteps(finalParts('p', 'p-48fps-finished-labeled-intro.mp4')!)).toEqual([
            'frame-interpolated to 48 fps',
            'graded and sharpened',
            'with the EU AI marker',
            'with an intro',
        ])
        expect(variantSteps(finalParts('p', 'p.mp4')!)).toEqual([])
    })
    test('the facts leave out the interpolation of a 24 fps video and the upscaler of one not refinished', () => {
        const facts = {
            llm: [],
            gpus: [],
            software: '',
            models: [
                {what: 'Video', names: ['h3']},
                {what: 'Frame interpolation', names: ['rife']},
                {what: 'Upscaling', names: ['esrgan']},
            ],
        }
        expect(factsFor(facts, finalParts('p', 'p-finished.mp4')!).models.map(m => m.what)).toEqual(['Video'])
        expect(factsFor(facts, finalParts('p', 'p--fullhd-48fps.mp4')!).models.map(m => m.what)).toEqual(['Video', 'Frame interpolation', 'Upscaling'])
    })
    test('every final video can be published, the preview and other files not', () => {
        const dir = folder()
        for (const name of ['p.mp4', 'p-48fps-finished-intro.mp4', 'p-preview.mp4', 'p-partial.mp4', 'p.youtube.txt', 'other.mp4'])
            writeFileSync(join(dir, name), '')
        expect(publishableVideos(dir, 'p').map(v => v.name)).toEqual(['p-48fps-finished-intro.mp4', 'p.mp4'])
    })
})

describe('descriptionText', () => {
    const parts = finalParts('p', 'p-48fps-finished.mp4')!
    const base = {
        title: 'Bone Saws',
        kind: 'music' as const,
        story: 'Two boys in the mud.',
        facts: {llm: ['qwen'], gpus: ['RTX 5090 (32 GB)'], software: 'FeverSlop TS 0.9.0 · ComfyUI · ffmpeg', models: [{what: 'Video', names: ['h3']}]},
        phases: [
            {what: 'Planning (language model)', seconds: 600, jobs: 10, failedSeconds: 0, failed: 0},
            {what: 'Clips', seconds: 7200, jobs: 40, failedSeconds: 300, failed: 2},
        ],
        parts,
        video: {width: 1920, height: 1088, fps: 48, seconds: 302},
        aiSong: false,
    }
    test('story, the AI disclosure, the program, how it was made, the tags', () => {
        const {description, warnings} = descriptionText(base, POSTWORK_DEFAULTS.description)
        expect(description.startsWith('Two boys in the mud.\n\nThis music video is entirely AI-generated')).toBe(true)
        expect(description).toContain(DEFAULT_ABOUT)
        expect(description).toContain('Rendered on: RTX 5090 (32 GB)')
        expect(description).toContain('- Planning (language model): 10 min (10 calls)')
        expect(description).toContain('- Clips: 2 h 00 min (40 jobs)')
        expect(description).toContain('- Total: 2 h 10 min')
        expect(description).toContain('- Failed and retried attempts on top: 5 min (2)')
        expect(description).toContain('This video: 1920×1088, 48 fps, 5:02 - frame-interpolated to 48 fps, graded and sharpened')
        expect(description.endsWith('#AIgenerated #feverslop #AIvideo')).toBe(true)
        expect(warnings).toEqual([])
    })
    test('without facts, story and tags: only what is always said', () => {
        const {description} = descriptionText({...base, story: undefined}, {...POSTWORK_DEFAULTS.description, facts: false, tags: [], about: 'Mine.'})
        expect(description).toBe('This music video is entirely AI-generated: every picture and every movement came out of AI models.\n\nMine.')
    })
    test('the song is named only when it was rendered', () => {
        expect(descriptionText({...base, aiSong: true}, POSTWORK_DEFAULTS.description).description).toContain('the song as well')
    })
    test('too long for YouTube is said, not cut', () => {
        const {description, warnings} = descriptionText(base, {...POSTWORK_DEFAULTS.description, about: 'x'.repeat(6000)})
        expect(description.length).toBeGreaterThan(5000)
        expect(warnings[0]).toContain('YouTube takes 5000')
    })
})

describe('the story', () => {
    test('a music video: its summary and the heading of its story', () => {
        const dir = folder()
        writeFileSync(join(dir, 'project.json'), JSON.stringify({story: "# The Bone-Saw's Dirge\n\nThe silence...", summary: 'In the trenches.'}))
        expect(storySource(dir, 'music')).toBe('In the trenches.')
        expect(storyTitle(dir)).toBe("The Bone-Saw's Dirge")
    })
    test('a film: the logline before the summary; nothing to go by: undefined', () => {
        const dir = folder()
        writeFileSync(join(dir, 'project.json'), JSON.stringify({brief: {logline: 'A singer returns.'}, summary: 'She walks the stage.'}))
        expect(storySource(dir, 'film')).toBe('A singer returns.\n\nShe walks the stage.')
        expect(storySource(folder(), 'film')).toBeUndefined()
    })
})

test('the settings are checked', () => {
    expect(postworkProblem({description: {tags: ['AI generated']}})).toContain('hashtags')
    expect(postworkProblem({description: {story: 'yes'}})).toContain('true or false')
    expect(postworkProblem({description: {about: 'two\nlines', extra: ['youtube.com/@me']}})).toBeUndefined()
})

test('the workspace starts the command with the video chosen, and nothing without one', async () => {
    const {runCommand} = await import('../editor/runs.ts')
    expect(
        runCommand(
            {id: 'demo', kind: 'music'},
            {type: 'description', from: 'demo-48fps-finished.mp4', story: true, newStory: true, facts: false, tags: ['AIgenerated'], extra: [], save: true},
        ),
    ).toEqual({
        script: 'tools/description.ts',
        args: ['demo', '--from=demo-48fps-finished.mp4', '--no-lines', '--tag=AIgenerated', '--story', '--no-facts', '--new-story', '--save'],
    })
    expect(() => runCommand({id: 'demo', kind: 'music'}, {type: 'description', from: ''})).toThrow('no such from')
    expect(() => runCommand({id: 'demo', kind: 'film'}, {type: 'description', from: 'demo.mp4', hardware: 'a\nb'})).toThrow('one line of text')
})
