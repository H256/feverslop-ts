import {describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {probeVideo} from "../assemble.ts";
import {finalLabel} from "../editor/project.ts";
import {runCommand} from "../editor/runs.ts";
import type {Timing} from "../timings.ts";
import {POSTWORK_DEFAULTS, postworkProblem} from "./config.ts";
import {collectFacts, creditLines, creditsFilter, creditsVideo, endSeconds, fontFiles, linesFilter, projectTitle, workflowModels} from "./credits.ts";

const credits = POSTWORK_DEFAULTS.credits
const timing = (t: Partial<Timing>): Timing => ({at: '2026-11-05T00:00:00Z', project: 'demo', kind: 'clip', name: 'h3-ref2video', seconds: 60, ...t})

describe('credits - a title card and the credits of a finished video (#609)', () => {
    test('the facts come from what the project ran: language models, models by kind, graphics cards - nothing else', () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'facts-')), 'demo')
        mkdirSync(dir)
        const timings = [
            timing({kind: 'llm', name: 'Qwen3.8-27B'}),
            timing({kind: 'llm', name: 'Qwen3.8-27B'}),
            timing({kind: 'clip', setup: {models: ['unet_name=minimax_h3.safetensors', 'vae_name=video_vae.safetensors', 'clip_name=qwen3vl_32b.safetensors'], loras: [{file: 'turbo.safetensors'}]}, gpu: 'cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync', vramGb: 31.8}),
            timing({kind: 'picture', name: 'h3-sequence-to-sheet', setup: {models: ['unet_name=fl2va.safetensors'], loras: []}, gpu: 'AMD Radeon AI PRO R9700', vramGb: 32}),
            // another project, and a failed job: neither counts
            timing({project: 'other', kind: 'llm', name: 'gpt-x'}),
            timing({kind: 'clip', outcome: 'failed', gpu: 'Broken GPU'}),
        ]
        const facts = collectFacts(dir, {timings, version: '0.7.0'})
        expect(facts.llm).toEqual(['Qwen3.8-27B'])
        expect(facts.models).toEqual([{what: 'Video', names: ['minimax_h3', 'qwen3vl_32b', 'turbo']}, {what: 'Reference sheets', names: ['fl2va']}])
        expect(facts.gpus).toEqual(['NVIDIA GeForce RTX 5090 (32 GB)', 'AMD Radeon AI PRO R9700 (32 GB)'])
        expect(facts.software).toBe('FeverSlop TS 0.7.0 · ComfyUI · ffmpeg')
    })
    test('a render that was not measured: the workflow of its sidecar, and the models that workflow names', () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'sidecars-')), 'demo')
        mkdirSync(join(dir, 'videos'), {recursive: true})
        writeFileSync(join(dir, 'videos', 'slot-001.mp4.json'), JSON.stringify({workflow: 'h3-ref2video', seed: 1}))
        const facts = collectFacts(dir, {timings: [], version: '0.7.0', fallbackLlm: 'local-model'})
        expect(facts.llm).toEqual(['local-model'])
        expect(facts.models[0]!.what).toBe('Video')
        expect(facts.models[0]!.names).toContain('minimax_h3_ref2va_pruned_int8_convrot')
        expect(facts.gpus).toEqual([])
        expect(workflowModels("wf.UNETLoader({unet_name: 'a.safetensors'}); wf.VAELoader({vae_name: 'v.safetensors'})")).toEqual(['a'])
    })
    test('the title card: title, who, the disclosure; the credits add the own lines and the facts, the disclosure last', () => {
        const facts = {llm: ['Qwen'], models: [{what: 'Video', names: ['minimax_h3']}], gpus: ['RTX 5090'], software: 'FeverSlop TS 0.7.0 · ComfyUI · ffmpeg'}
        const {opening, end} = creditLines({...credits, artist: 'Klemens', extra: ['Thanks'], hardware: 'LLM: Strix Halo'}, facts, {title: 'Song', kind: 'music'})
        expect(opening.map(l => l.text)).toEqual(['Song', 'by Klemens', '', 'Contains AI-generated content'])
        const texts = end.map(l => l.text)
        expect(texts.slice(0, 4)).toEqual(['Song', 'by Klemens', '', 'Thanks'])
        expect(texts).toContain('Language model')
        expect(texts.slice(texts.indexOf('Hardware'), texts.indexOf('Hardware') + 3)).toEqual(['Hardware', 'RTX 5090', 'LLM: Strix Halo'])
        expect(texts.at(-1)).toBe('Contains AI-generated content')
        // a film says who directed it; no facts, no disclosure: only what is set
        const film = creditLines({...credits, director: 'K. W.', facts: false, disclosure: ''}, facts, {title: 'Film', kind: 'film'})
        expect(film.opening.map(l => l.text)).toEqual(['Film', 'Directed by K. W.'])
        expect(film.end.map(l => l.text)).toEqual(['Film', 'Directed by K. W.'])
    })
    test('the credits run 1.5 s a line, at least 8 s, unless a length is set', () => {
        expect(endSeconds({endSeconds: 0}, 3)).toBe(8)
        expect(endSeconds({endSeconds: 0}, 20)).toBe(30)
        expect(endSeconds({endSeconds: 12}, 20)).toBe(12)
    })
    test('every line is a drawtext of its own, read from a file, centred, sized by the height of the video', () => {
        const {filter, files, height} = linesFilter([{text: 'Song', size: 'title'}, {text: '', size: 'normal'}, {text: '50% done: %{pts}', size: 'small'}], 1000, 'h-t*40')
        expect(files).toEqual({'l0.txt': 'Song', 'l2.txt': '50% done: %{pts}'})
        expect(filter).toContain('drawtext=fontfile=bold.ttf:textfile=l0.txt:expansion=none:fontsize=75:fontcolor=white:x=(w-text_w)/2:y=h-t*40+0')
        expect(filter).toContain('textfile=l2.txt:expansion=none:fontsize=28')
        expect(height).toBe(Math.round((75 + 36 + 28) * 1.55))
    })
    test('the graph: the card, the video, the credits, joined - silence under the cards, or a sound under the credits', () => {
        const plan = {width: 1280, height: 720, fps: 24, opening: {lines: [{text: 'Song', size: 'title' as const}], seconds: 4, marker: true}, end: {lines: [{text: 'Song', size: 'title' as const}], seconds: 10}, videoAudio: true, sound: true}
        const {filter} = creditsFilter(plan, {marker: 1, sound: 2})
        expect(filter).toContain('color=c=black:s=1280x720:r=24:d=4.000')
        expect(filter).toContain('[1:v]scale=-2:44:flags=lanczos,format=rgba[ocm]')
        expect(filter).toContain('[2:a]aresample=48000')
        expect(filter).toEndWith('[ov][oa][mv][ma][ev][ea]concat=n=3:v=1:a=1[v][a]')
        const quiet = creditsFilter({...plan, opening: undefined, videoAudio: false, sound: false}).filter
        expect(quiet).toEndWith('[mv][ev]concat=n=2:v=1:a=0[v]')
        expect(quiet).not.toContain('anullsrc')
    })
    test('settings: one line each, a list for the lines of your own; the title of a film is its own', () => {
        expect(postworkProblem({credits: {extra: ['a', 'b']}})).toBeUndefined()
        expect(postworkProblem({credits: {extra: 'a'}})).toContain('must be a list of lines')
        expect(postworkProblem({credits: {title: 'two\nlines'}})).toContain('must be one line of text')
        expect(postworkProblem({credits: {openingSeconds: 0}})).toContain('openingSeconds must be')
        const dir = mkdtempSync(join(tmpdir(), 'title-'))
        writeFileSync(join(dir, 'project.json'), JSON.stringify({screenplay: {title: 'The Last Rehearsal'}}))
        expect(projectTitle(dir, 'film', 'last-rehearsal', '')).toBe('The Last Rehearsal')
        expect(projectTitle(dir, 'music', 'my-song', '')).toBe('my-song')
        expect(projectTitle(dir, 'music', 'my-song', 'My Song')).toBe('My Song')
        expect(fontFiles('', dir).bold).toEndWith('Lato-Bold.ttf')
        expect(() => fontFiles('none.ttf', dir)).toThrow('no file none.ttf')
    })
    test('the workspace: the command for the page, and the video under the one it was made from', () => {
        expect(runCommand({id: 'demo', kind: 'music'}, {type: 'credits', from: 'demo.mp4', opening: true, end: false, title: 'Song', artist: 'Klemens', director: 'ignored', extra: ['Thanks', 'Links'], facts: false, openingSeconds: 5, save: true}))
            .toEqual({script: 'tools/credits.ts', args: ['demo', '--from=demo.mp4', '--title=Song', '--artist=Klemens', '--line=Thanks', '--line=Links', '--opening', '--no-end', '--no-facts', '--opening-seconds=5', '--save']})
        expect(runCommand({id: 'demo', kind: 'film'}, {type: 'credits', director: 'K. W.', extra: []})).toEqual({script: 'tools/credits.ts', args: ['demo', '--film', '--director=K. W.', '--no-lines']})
        expect(() => runCommand({id: 'demo', kind: 'music'}, {type: 'credits', title: 'a\nb'})).toThrow('one line of text')
        expect(finalLabel('demo', 'demo-labeled-credits-intro.mp4')).toMatchObject({label: 'Final + AI label + credits + intro'})
    })
})

test('writes <name>-credits.mp4: the title card, the whole video with its sound, the credits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'credits-'))
    const video = join(dir, 'demo.mp4')
    expect(Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]).exitCode).toBe(0)
    const lines = creditLines({...credits, artist: 'Test'}, undefined, {title: 'Demo', kind: 'music'})
    const done = await creditsVideo(video, lines, {...credits, openingSeconds: 2, endSeconds: 3}, fontFiles('', dir))
    expect(done.file).toBe(join(dir, 'demo-credits.mp4'))
    const info = await probeVideo(done.file)
    expect({frames: info.frames, width: info.width, hasAudio: info.hasAudio}).toEqual({frames: (2 + 2 + 3) * 24, width: 320, hasAudio: true})
    // the card is dark with white letters, the video red
    const mean = (at: number, filter: string) => {
        const out = Bun.spawnSync(['ffmpeg', '-v', 'error', '-ss', String(at), '-i', done.file, '-frames:v', '1', '-vf', `${filter},signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-`, '-f', 'null', '-'])
        return Number(/YMAX=(\d+)/.exec(out.stdout.toString())?.[1])
    }
    expect(mean(1, 'format=gray')).toBeGreaterThan(200)
    expect(mean(3, 'format=gray')).toBeLessThan(120)
})
