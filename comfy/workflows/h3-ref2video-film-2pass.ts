// The short-film pipeline's clips in two passes - the recipe of h3-ref2video-2pass (comfy/h3-two-pass.ts, the same code), with
// the film's inputs: pictures only, no audio goes in, and the sound is the model's own (dialogue and ambience from the prompt),
// decoded from the latent after pass 2. videoResolution is the final size (-1 = 2 MP, pass 1 at 0.5 MP).
// Select it with "videoWorkflow": "h3-ref2video-film-2pass" in the film's config.json.
import type {WorkflowResult} from '../helpers.ts'
import {twoPassWorkflow} from '../h3-two-pass.ts'
import type {FilmVideoWorkflowOptions} from './h3-ref2video-film.ts'

export {renderFrames} from './h3-ref2video-film.ts'

export default (opts: FilmVideoWorkflowOptions): WorkflowResult => twoPassWorkflow(opts, 'h3-ref2video-film-2pass')
