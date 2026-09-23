# Custom ComfyUI workflows

The workflows FeverSlop TS renders with are TypeScript files in `comfy/workflows/`, built with the
[ComfyUI SDK](https://github.com/comfy-addons/comfyui-sdk) (`@saintno/comfyui-sdk`). A workflow is a function: it
gets the values of one render (prompt, seed, resolution, pictures, …), builds the node graph from them and returns
it. The builder is generated from your server, so TypeScript checks every node, model name and connection before
anything is sent to ComfyUI.

This guide shows how to turn a workflow you built in ComfyUI into such a file, and how to use it in a project.

For rendering and `config.json` in general, see [comfyui.md](comfyui.md).

## Contents

- [Quick start](#quick-start)
- [The workflow contract](#the-workflow-contract)
- [Step by step: from ComfyUI to code](#step-by-step-from-comfyui-to-code)
- [Wiring in the parameters](#wiring-in-the-parameters)
- [Helpers](#helpers)
- [The output node](#the-output-node)
- [Writing a workflow by hand](#writing-a-workflow-by-hand)
- [Testing a workflow](#testing-a-workflow)
- [Checklist](#checklist)

## Quick start

```bash
# 1. in ComfyUI: Workflow → Export (API) → save as comfy/my-flux-image.json
# 2. generate a draft workflow file from it
bun run comfy:convert comfy/my-flux-image.json my-flux-image --kind=image
# 3. edit comfy/workflows/my-flux-image.ts: replace the TODO values with opts
# 4. check it
bun run typecheck
# 5. use it in a project: projects/<project-id>/config.json
#    "imageWorkflow": "my-flux-image"
bun index.ts --render=images
```

## The workflow contract

A workflow file has a default export function. It takes the options of its kind and returns the builder and the id
of the node whose files are downloaded:

```ts
import {type ImageWorkflowOptions, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function myImage(opts: ImageWorkflowOptions): WorkflowResult {
    const wf = new WorkflowBuilder()
    // ... nodes: wf.UNETLoader({…}), wf.KSampler({…}), …
    return {workflow: wf, output: save.__id}
}
```

There are two kinds, defined in `comfy/helpers.ts`:

**Image workflows** (`imageWorkflow` in `config.json`) - render one reference picture:

| Option           | Type                         | Meaning                                                                          |
|------------------|------------------------------|----------------------------------------------------------------------------------|
| `prompt`         | `string`                     | the Krea 2 prompt of the character or location                                   |
| `seed`           | `number`                     | already resolved - never `-1`                                                    |
| `resolution`     | `-1 \| number \| "WxH"`      | the `imageResolution` setting - pass it to `resolution()`                        |
| `orientation`    | `'portrait' \| 'landscape'`  | portrait for characters, landscape for locations                                 |
| `filenamePrefix` | `string`                     | where ComfyUI should save the result, e.g. `feverslop-ts/<project>/characters/thorin` |

Must save exactly one **PNG**.

**Video workflows** (`videoWorkflow` in `config.json`) - render one clip:

| Option           | Type                    | Meaning                                                                                          |
|------------------|-------------------------|--------------------------------------------------------------------------------------------------|
| `prompt`         | `string`                | the H3 prompt of the clip (`output/clips/<id>.json`)                                             |
| `pictures`       | `string[]`              | ComfyUI input names of the reference pictures, in `<Picture N>` order - already uploaded          |
| `song`           | `string`                | ComfyUI input name of the full song - already uploaded                                           |
| `vocals`         | `string \| undefined`   | only for clips with a singer: ComfyUI input name of the song's isolated vocals (`<Audio 2>`) - already uploaded |
| `songStart`      | `number`                | where the audio starts, seconds - exactly on the clip's first frame                              |
| `frames`         | `number`                | the number of frames to render - already a length the model accepts (see `renderFrames` below)   |
| `duration`       | `number`                | `frames / FPS` - how much audio to trim, covering the whole render                               |
| `seed`           | `number`                | already resolved - never `-1`                                                                    |
| `resolution`     | `-1 \| number \| "WxH"` | the `videoResolution` setting - pass it to `resolution()` with `'landscape'`                     |
| `filenamePrefix` | `string`                | where ComfyUI should save the result                                                             |

Must save exactly one **MP4**, 24 fps (`FPS` from `helpers.ts`), with at least `frames` frames. Frame 0 must belong to
the audio at `songStart` - FeverSlop TS cuts every clip back to its own frames from frame 0 on when it assembles the
final video, so a workflow that drops or adds frames at the start breaks the sync.

A video workflow can also export `renderFrames`, for models that only render certain lengths:

```ts
import type {RenderFrames} from "../helpers.ts";

// the clip needs `frames` frames - return the length to render instead, never less
export const renderFrames: RenderFrames = frames => 5 + 17 * Math.ceil(Math.max(0, frames - 5) / 17)
```

FeverSlop TS calls it with the frames the clip needs and passes the result as `opts.frames`; the extra frames are cut
off in the final video. Without `renderFrames`, `opts.frames` is exactly what the clip needs. Details:
[frame-exact timing](comfyui.md#the-final-video-and-frame-exact-timing).

The uploads, running the job and the download are done by FeverSlop TS - a workflow only builds the graph. Everything
a workflow needs from the project comes in through `opts`.

## Step by step: from ComfyUI to code

### 1. Prepare the workflow in ComfyUI

Build and test the workflow in ComfyUI as usual. Two things make the conversion easier:

- **Give the nodes that take a parameter a title starting with `#`**, e.g. `#PROMPT`, `#SEED`, `#DIMENSIONS`,
  `#SAVE_IMAGE`, `#REF_1`. The converter marks these nodes with a TODO, so you see at once where to wire in `opts`.
- **Use one save node** for the result (`SaveImage` for pictures, `VHS_VideoCombine` for videos). Remove preview or
  extra save nodes you don't need.

### 2. Export it in API format

In ComfyUI: **Workflow → Export (API)**. Save the file anywhere, e.g. `comfy/my-flux-image.json`. The normal export
(with the UI layout) doesn't work - the converter tells you if you picked the wrong one.

### 3. Convert it

```bash
bun run comfy:convert <workflow-api.json> <name> --kind=image|video
```

- `<name>` becomes the file `comfy/workflows/<name>.ts` and the name you put into `config.json`.
- `--kind` picks the options type (`ImageWorkflowOptions` or `VideoWorkflowOptions`).
- An existing file is not overwritten unless you add `--force`.
- ComfyUI must be running - the converter reads output names and dropdown values from the server (the first one of
  the settings, see [README → Setup](../README.md#setup), or `--comfy=http://host:8188`) and the builder's method names
  from `comfy/nodes.ts`. After installing nodes, run `bun run comfy:types` first.

The draft contains every node of the export in dependency order, connected as in ComfyUI, with all values as they were
exported. It type-checks as it is, so you can run it right away - it just renders the exported prompt every time.

What the converter does for you:

- names every node after its type and id, e.g. `kSampler_53` or `vAEDecode_54`, and connects outputs by name
  (`vAEDecode_54.IMAGE`) - rename the variables as you like
- wraps values the server doesn't list in `dyn(…)` - file names like uploaded images, see [dyn](#dyn)
- wraps node outputs that go into a widget in `widget(…)` - e.g. a `ResolutionSelector` into `width`, see
  [widget](#widget)
- puts inputs the node types don't know into `withInputs(…)` - see [withInputs](#withinputs)
- casts outputs of wildcard sockets like `VRAMCleanup` with `as never`, see [afterCleanup](#aftercleanup)
- picks the last output node as `output` and lists the others in a comment
- adds a warning comment for nodes that aren't installed on the server

### 4. Wire in the parameters

Replace the exported values with `opts` - see the next section. Delete the TODO comments as you go.

### 5. Check and use it

```bash
bun run typecheck
```

Then set it in a project's `config.json` and render - see [Testing a workflow](#testing-a-workflow).

## Wiring in the parameters

Here's what a draft looks like and how it becomes a workflow. The converter output for the Krea 2 export:

```ts
// TODO #PROMPT_POSITIVE: wire opts in here
const cLIPTextEncode_51 = wf.CLIPTextEncode({text: "A high resolution cinematic photograph of …", clip: cLIPLoader_56.CLIP})
// TODO #DIMENSIONS: wire opts in here
const emptyLatentImage_52 = wf.EmptyLatentImage({width: 1920, height: 1088, batch_size: 1})
const kSampler_53 = wf.KSampler({seed: 672800148947068, steps: 12, /* … */})
const vRAMCleanup_77 = wf.VRAMCleanup({offload_model: true, offload_cache: true, anything: vAEDecode_54.IMAGE})
// TODO #SAVE_IMAGE: wire opts in here
const saveImage_29 = wf.SaveImage({filename_prefix: "Krea2_turbo", images: vRAMCleanup_77.output as never})
```

and wired:

```ts
const cLIPTextEncode_51 = wf.CLIPTextEncode({text: opts.prompt, clip: cLIPLoader_56.CLIP})
const size = resolution(wf, opts.resolution, opts.orientation, '1920x1088')
const emptyLatentImage_52 = wf.EmptyLatentImage({width: size.width, height: size.height, batch_size: 1})
const kSampler_53 = wf.KSampler({seed: opts.seed, steps: 12, /* … */})
const saveImage_29 = wf.SaveImage({filename_prefix: opts.filenamePrefix, images: afterCleanup(wf, vAEDecode_54.IMAGE)})
```

The parameters every workflow of a kind has to wire:

| Parameter   | Image workflow                                     | Video workflow                                                        |
|-------------|----------------------------------------------------|-----------------------------------------------------------------------|
| prompt      | the positive text encoder: `opts.prompt`           | the prompt input: `opts.prompt`                                       |
| seed        | the sampler's `seed` / `noise_seed`: `opts.seed`   | same                                                                  |
| size        | `resolution(wf, opts.resolution, opts.orientation, <workflow size>)` | `resolution(wf, opts.resolution, 'landscape', <workflow size>)` |
| file name   | the save node's `filename_prefix`: `opts.filenamePrefix` | same                                                            |
| pictures    | –                                                  | one `LoadImage` per entry of `opts.pictures`, see below               |
| audio       | –                                                  | `LoadAudio(opts.song)` + `TrimAudioDuration(opts.songStart, opts.duration)` |
| length      | –                                                  | `opts.frames`, plus a `renderFrames` export if the model needs it     |

For `<workflow size>` use the size the workflow was designed with - it's what `-1` in `config.json` means: a
`"WIDTHxHEIGHT"` string, or a number for megapixels. Remove the original size nodes (`EmptyLatentImage` values,
`ResolutionSelector`, size primitives) that `resolution()` replaces.

### Reference pictures (video)

An export has a fixed number of `LoadImage` nodes. Replace them with one per picture, so a clip with two pictures and a
clip with six both work. For nodes with autogrow inputs like `MiniMaxH3ReferenceToVideo`:

```ts
withInputs(wf, r2v, Object.fromEntries(opts.pictures.map((picture, i) =>
    [`ref_images.ref_image_${i}`, wf.LoadImage({image: dyn(picture)}).IMAGE])))
```

`opts.pictures[0]` is `<Picture 1>` in the prompt, `opts.pictures[1]` is `<Picture 2>`, and so on - keep that order.

### Audio (video)

Load the full song and cut the clip's part out of it:

```ts
const song = wf.LoadAudio({audio: dyn(opts.song)})
const audio = wf.TrimAudioDuration({audio: song.AUDIO, start_index: opts.songStart, duration: opts.duration})
```

Use `audio.AUDIO` everywhere the clip's audio is needed: reference audio, audio guide, the save node's `audio`.

### Vocals (video, singing characters)

For clips with a singer, `opts.vocals` is the full vocals stem of the song. Trim it exactly like the song - same
`songStart` and `duration` - and give it to the model as the second reference audio, the voice the singer's lips
follow. The prompt calls it `<Audio 2>`. Keep the audio guide and the save node on the full mix:

```ts
const vocals = opts.vocals
    ? wf.TrimAudioDuration({audio: wf.LoadAudio({audio: dyn(opts.vocals)}).AUDIO, start_index: opts.songStart, duration: opts.duration})
    : undefined
withInputs(wf, r2v, {'ref_audios.ref_audio_0': audio.AUDIO, ...(vocals ? {'ref_audios.ref_audio_1': vocals.AUDIO} : {})})
```

A workflow that ignores `opts.vocals` still works, just without the voice reference.

### Length (video)

Pass `opts.frames` to the model's length input - don't compute a length from `opts.duration`, floating point
rounding can land on the wrong frame count:

```ts
const length = wf.PrimitiveInt({value: opts.frames})
wf.MiniMaxH3ReferenceToVideo({length: widget(length.INT), /* … */})
// or directly: wf.MiniMaxH3ReferenceToVideo({length: opts.frames, /* … */})
```

If the model only accepts certain frame counts, export a `renderFrames` function that rounds up to the next valid one
(see [the contract](#the-workflow-contract)). `h3-ref2video.ts` has it for H3's 5 + 17·k frames. Without it, a model
that rounds the length itself would silently return a different frame count than planned.

## Helpers

All in `comfy/helpers.ts`. `WorkflowBuilder` is exported from there too, so a workflow file only imports from
`../helpers.ts`.

### resolution

```ts
resolution(wf, setting, orientation, workflowDefault): {width, height}
```

Turns a resolution setting into width and height for the workflow and adds the nodes it needs: a
`ResolutionSelector` for megapixels, two `PrimitiveInt` for `"WxH"`. The result always has the given orientation.
Pass `width` and `height` to whatever takes the size (`EmptyLatentImage`, a video node, …) - they are typed as numbers,
so they fit widget inputs.

### dyn

```ts
wf.LoadImage({image: dyn(opts.pictures[0])})
```

Dropdown inputs are typed with the values the server listed when `nodes.ts` was generated. A value that didn't exist
then - an uploaded file, a model installed later - doesn't type-check. `dyn(value)` lets it through without a check.
Use it for uploaded files; for models, regenerate `nodes.ts` instead (`bun run comfy:types`), so a typo is still caught.

### widget

```ts
const width = wf.PrimitiveInt({value: 1280})
wf.EmptyLatentImage({width: widget(width.INT), height: 720, batch_size: 1})
```

In ComfyUI every widget (number, text, dropdown) can be turned into an input and connected to a node output. The
generated types only allow plain values for widgets; `widget(output)` marks such a connection. The connection itself
is not type-checked.

### withInputs

```ts
withInputs(wf, video, {pix_fmt: 'yuv420p', crf: 19, trim_to_audio: false})
```

Sets inputs the node types don't have:

- **autogrow inputs** - slots that appear as you connect them, like `ref_images.ref_image_0`, `ref_images.ref_image_1`
- **widgets that depend on another widget** - e.g. `VHS_VideoCombine` only has `crf` and `pix_fmt` for some formats

Call it before the workflow is returned. These values are not type-checked - compare them with the exported JSON.

### afterCleanup

```ts
const images = afterCleanup(wf, decoded.IMAGE, {offload_model: true, offload_cache: true})
wf.SaveImage({images, filename_prefix: opts.filenamePrefix})
```

Adds a `VRAMCleanup` node and returns its output with the type of what went in, so the next node still type-checks.
Both options default to `true`. The converter uses `as never` casts for the same thing - that works, but turns off the
check for that connection; `afterCleanup` keeps it.

### resolveSeed, FPS

`resolveSeed(-1)` returns a random seed - FeverSlop TS already calls it, workflows get a resolved `opts.seed`.
`FPS` is 24, the frame rate of all videos.

## The output node

`output` must be the `__id` of the node that saves the result - `SaveImage` for pictures, `VHS_VideoCombine` or
similar for videos. After the job, FeverSlop TS downloads that node's files and saves the `.png` (pictures) or `.mp4`
(videos) into the project - if the node saves several, the last one wins, so save exactly one. Other files of the
node, like a PNG preview next to a video, are ignored.

If a render fails with `the output node saved no .png file` (or `.mp4`):

- `output` points to the wrong node (e.g. a `VRAMCleanup` - it's also an "output node" for ComfyUI), or
- the node saves another format (e.g. WebM instead of MP4) - change the format in the workflow.

The message lists the files the node did save.

## Writing a workflow by hand

You don't need the converter - it's just a starting point. The included workflows are written by hand and are the
best reference:

- `comfy/workflows/krea2-image.ts` - text to image with a negative prompt trick, `resolution()` and `afterCleanup()`
- `comfy/workflows/h3-ref2video.ts` - reference pictures via `withInputs`, audio trimming, `widget`, `renderFrames`,
  VHS widgets

Every node is a method on the builder, named like its ComfyUI type: `wf.KSampler({…})`. Types with characters that
aren't valid in a name are written in PascalCase: `"easy saveText"` is `wf.EasySaveText({…})`. Outputs are properties
named like the output: `.MODEL`, `.CLIP`, `.LATENT`. Your editor's autocomplete shows all nodes, inputs, outputs and
allowed values.

A workflow can be split into functions - one for the model loaders, one for the sampler - as long as they all add
their nodes to the same `wf`.

## Testing a workflow

1. `bun run typecheck` - no errors in your file.
2. Make a test project, or use an existing one, and set the workflow in its `config.json`:

   ```json
   {"imageWorkflow": "my-flux-image", "seed": 42}
   ```

3. Render a single picture or clip: delete one file from `assets/` (or pick one clip) and run

   ```bash
   bun index.ts <project-id> --render=images
   bun index.ts <project-id> --render=videos --only=slot-001
   ```

4. Look at the result and its `.json`. A fixed seed makes it easier to compare changes.

To see the exact JSON a workflow sends to ComfyUI:

```ts
// scratch.ts - bun scratch.ts
import myImage from "./comfy/workflows/my-flux-image.ts"
const {workflow, output} = myImage({prompt: 'test', seed: 1, resolution: -1, orientation: 'portrait', filenamePrefix: 'test'})
console.log(JSON.stringify(workflow.build({outputs: {result: output}}).workflow, null, 2))
```

## Checklist

- [ ] exported with **Export (API)**
- [ ] `opts.prompt`, `opts.seed` and `opts.filenamePrefix` wired in
- [ ] size through `resolution(…)`, old size nodes removed
- [ ] video: one `LoadImage` per `opts.pictures` entry, in order
- [ ] video: song trimmed with `opts.songStart` / `opts.duration`, length from `opts.frames`
- [ ] video: `opts.vocals`, if set, trimmed the same way and used as the second reference audio
- [ ] video: `renderFrames` exported if the model only renders certain lengths
- [ ] exactly one save node, and `output` is its `__id`
- [ ] saves PNG (image) or MP4 (video)
- [ ] `bun run typecheck` has no errors
- [ ] set as `imageWorkflow` / `videoWorkflow` in the project's `config.json`
