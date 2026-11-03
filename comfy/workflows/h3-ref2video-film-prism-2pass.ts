// The film's two-pass clips with the distilled PRISM DMAD/PDMD checkpoint: the recipe of h3-ref2video-prism-2pass with the film's
// inputs, as h3-ref2video-film-2pass has them (comfy/h3-two-pass.ts, PRISM_TWO_PASS).
// Select it with "videoWorkflow": "h3-ref2video-film-prism-2pass" in the film's config.json.
import type {WorkflowResult} from "../helpers.ts";
import {PRISM_TWO_PASS, twoPassWorkflow} from "../h3-two-pass.ts";
import type {FilmVideoWorkflowOptions} from "./h3-ref2video-film.ts";

export {renderFrames} from "./h3-ref2video-film.ts"

export default (opts: FilmVideoWorkflowOptions): WorkflowResult => twoPassWorkflow(opts, 'h3-ref2video-film-prism-2pass', PRISM_TWO_PASS)
