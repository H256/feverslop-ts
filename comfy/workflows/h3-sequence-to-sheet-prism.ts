// h3-sequence-to-sheet with the distilled PRISM DMAD/PDMD checkpoint (PRISM_DMAD_PDMD_int8.safetensors in diffusion_models/):
// no turbo LoRA, shift 12/3, 4 steps euler/beta57 - the sampling of its two-pass clips. beta57 is a scheduler of the RES4LYF
// nodes. See comfy/h3-sequence-sheet.ts (PRISM_SHEET).
// Select it with "sequenceWorkflow": "h3-sequence-to-sheet-prism" in config.json, or on the Settings page.
import type {SequenceWorkflowOptions, WorkflowResult} from "../helpers.ts";
import {PRISM_SHEET, sequenceSheetWorkflow} from "../h3-sequence-sheet.ts";

export default (opts: SequenceWorkflowOptions): WorkflowResult => sequenceSheetWorkflow(opts, PRISM_SHEET)
