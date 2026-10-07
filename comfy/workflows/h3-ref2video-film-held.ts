// The film's video workflow for clips with a held shot (a talking close-up, a conversation: the planner's `hold`) - the same graph as
// h3-ref2video-film.ts, but without the turbo LoRA: res_multistep, beta scheduler, 20 steps. The turbo LoRA makes the picture move whatever the
// prompt says (the camera zooms in, a person walks up to it); this follows "the framing stays". About 2.5 times slower - the other clips keep the turbo.
import type {FilmVideoWorkflowOptions} from "./h3-ref2video-film.ts";
import {h3Film} from "./h3-ref2video-film.ts";
import type {WorkflowResult} from "../helpers.ts";

export {renderFrames} from "./h3-ref2video-film.ts";

export default function h3Ref2VideoFilmHeld(opts: FilmVideoWorkflowOptions): WorkflowResult {
    return h3Film(opts, {lora: false, sampler: 'res_multistep', scheduler: 'beta', steps: 20})
}
