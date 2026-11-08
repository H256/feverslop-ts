import {expect, test} from "bun:test";
import turbo from "./h3-ref2video.ts";
import cpuClip from "./h3-ref2video-cpu-clip.ts";
import full from "./h3-ref2video-full.ts";
import film from "./h3-ref2video-film.ts";
import filmBeta from "./h3-ref2video-film-beta.ts";
import type {VideoWorkflowOptions} from "../helpers.ts";
import type {FilmVideoWorkflowOptions} from "./h3-ref2video-film.ts";

const video: VideoWorkflowOptions = {
    prompt: 'A test shot', pictures: ['picture'], audios: ['drums'], song: 'song', songStart: 0, frames: 22, duration: 1,
    seed: 1, resolution: '1280x720', filenamePrefix: 'test',
}
const filmVideo: FilmVideoWorkflowOptions = {
    prompt: 'A test shot', pictures: ['picture'], frames: 22, seed: 1, resolution: '1280x720', filenamePrefix: 'test',
}

test('all single-pass H3 variants build through the shared graph', () => {
    for (const result of [turbo(video), cpuClip(video), full(video), film(filmVideo), filmBeta(filmVideo)]) {
        expect(result.output).toBeTruthy()
        expect(result.size).toEqual({width: 1280, height: 720})
    }
})
