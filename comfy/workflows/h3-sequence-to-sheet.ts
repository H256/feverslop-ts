// Silent turnaround video from one still reference image, for the reference-sheet pipeline (lib/sequenceSheet.ts):
// hero image in, a few hard-cut "beats" (different angles/expression for a character, different views for a
// location) out, later sampled into frames and composited into a multi-angle reference sheet. Ported from the
// predecessor project's fever-slop workflow (sequence_to_sheet_minimax_h3_i2va_v1.json) onto this project's own
// MiniMaxH3ImageToVideo (first_frame, no ref_images/audio - unlike h3-ref2video.ts's MiniMaxH3ReferenceToVideo).
// The FL2VA model with its 8-step turbo LoRA - see comfy/h3-sequence-sheet.ts; h3-sequence-to-sheet-prism is the 4-step one.
import type {SequenceWorkflowOptions, WorkflowResult} from "../helpers.ts";
import {sequenceSheetWorkflow, TURBO_SHEET} from "../h3-sequence-sheet.ts";

export default (opts: SequenceWorkflowOptions): WorkflowResult => sequenceSheetWorkflow(opts, TURBO_SHEET)
