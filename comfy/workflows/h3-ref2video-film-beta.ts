// The film graph without the turbo LoRA, using ComfyUI's base-model sampler settings.
import type {FilmVideoWorkflowOptions} from './h3-ref2video-film.ts'
import {h3Ref2Video} from './h3-ref2video-builder.ts'
import type {WorkflowResult} from '../helpers.ts'

export {renderFrames} from './h3-ref2video-film.ts'

export default function h3Ref2VideoFilmBeta(opts: FilmVideoWorkflowOptions): WorkflowResult {
    return h3Ref2Video(opts, {name: 'h3-ref2video-film-beta', sampler: 'res_multistep', scheduler: 'beta', steps: () => 20})
}
