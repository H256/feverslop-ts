import {expect, test} from 'bun:test'
import type {VideoWorkflowOptions} from '../helpers.ts'
import prism from './h3-ref2video-prism-2pass.ts'
import turbo from './h3-ref2video.ts'

type Node = {class_type: string; inputs: Record<string, unknown>}

const video: VideoWorkflowOptions = {
    prompt: 'A test shot',
    pictures: ['picture'],
    audios: ['drums'],
    song: 'song',
    songStart: 0,
    frames: 193,
    duration: 8,
    seed: 1,
    resolution: '1280x720',
    filenamePrefix: 'test',
}
const nodesOf = (result: ReturnType<typeof prism>) => (result.workflow as unknown as {workflow: Record<string, Node>}).workflow
// the pictures locked into the video by MiniMaxH3AddGuide, with their frame: the song's guide has no image
const pictureGuides = (nodes: Record<string, Node>) =>
    Object.values(nodes)
        .filter(n => n.class_type === 'MiniMaxH3AddGuide' && n.inputs.image)
        .map(n => [nodes[(n.inputs.image as [string, number])[0]]!.inputs.image, n.inputs.frame_idx])

// #1187: the start picture of each shot locked at the shot's first frame - slot-028 held 3 of 3 that way, told only 0 of 3
test('each shot picture is a guide at its frame; in a two-pass workflow in pass 1 only', () => {
    const shotFrames = [
        {image: 'p/startframes/slot-028-shot1.png', at: 0},
        {image: 'p/startframes/slot-028-shot2.png', at: 96},
    ]
    // the 2-pass: pass 2 keeps what pass 1 laid out, as the test that held did - and as a part's end frame
    expect(pictureGuides(nodesOf(prism({...video, shotFrames})))).toEqual([
        ['p/startframes/slot-028-shot1.png', 0],
        ['p/startframes/slot-028-shot2.png', 96],
    ])
    expect(pictureGuides(nodesOf(turbo({...video, shotFrames})))).toEqual([
        ['p/startframes/slot-028-shot1.png', 0],
        ['p/startframes/slot-028-shot2.png', 96],
    ])
    // without pictures the graph is as before
    expect(pictureGuides(nodesOf(prism(video)))).toEqual([])
})
