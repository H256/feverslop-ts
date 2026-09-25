# Rendering with ComfyUI

FeverSlop TS can render the reference pictures (Krea 2) and the video clips (MiniMax H3 reference-to-video) directly on a
ComfyUI server, and saves the results into the project. This guide covers setup, the project `config.json`, how a
render works, and what to watch out for.

To write your own workflows, see [custom-workflows.md](custom-workflows.md).

## Contents

- [Setup](#setup)
- [Rendering](#rendering)
- [Project config (`config.json`)](#project-config-configjson)
- [What happens during a render](#what-happens-during-a-render)
  - [Several servers](#several-servers)
- [The final video and frame-exact timing](#the-final-video-and-frame-exact-timing)
- [Files a render produces](#files-a-render-produces)
- [Re-rendering](#re-rendering)
- [Node types (`comfy/nodes.ts`)](#node-types-comfynodests)
- [Things to know](#things-to-know)
- [Troubleshooting](#troubleshooting)

## Setup

1. **One or more running ComfyUI servers.** Without settings, FeverSlop TS connects to `http://localhost:8188`.
   Other servers - or several of them - are set up with:

   ```bash
   bun run setup comfy     # shows each server's GPU and free VRAM; add, remove, test
   ```

   A server behind a reverse proxy with authentication gets a bearer token or a username and password. For one run,
   `--comfy=` (or the env var `FEVERSLOP_COMFY`) replaces the list:

   ```bash
   bun index.ts --render=images --comfy=http://gpu-box.lan:8188,http://localhost:8188
   ```

   The settings file, the env vars and their order: [README → Setup](../README.md#setup). With several servers,
   pictures and clips are rendered on all of them at once - see [Several servers](#several-servers). **Every server
   needs the same models and custom nodes** (step 2).

2. **The models and custom nodes the workflows use.** The two included workflows need:

   | Workflow                          | Models                                                                                                                                                                                                              | Custom nodes                                               |
   |-----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
   | `krea2-image` (pictures)          | `krea2_turbo_fp8_scaled.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors`, `qwen_image_vae.safetensors`                                                                                                             | `VRAMCleanup`, `ResolutionSelector` (only for megapixels)   |
   | `h3-ref2video` (clips)            | `minimax_h3_ref2va_pruned_int8_convrot.safetensors`, `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` (LoRA), `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`, `minimax_h3_video_vae_fp16.safetensors`, `minimax_h3_audio_vae_fp32.safetensors` | `VHS_VideoCombine`, `VRAMCleanup`, `ResolutionSelector`     |

3. **Node types for your server.** `comfy/nodes.ts` describes every node and model installed on the server, so
   the workflows are checked against what is really there. It is generated from the first server of the settings (or
   `--comfy=<url>`); after installing nodes or models, regenerate it and check the workflows:

   ```bash
   bun run comfy:types
   bun run typecheck
   ```

## Rendering

Rendering is opt-in - a plain `bun index.ts` only plans. Add `--render`:

```bash
bun index.ts --render=all                       # missing pictures, missing clips, then the final video
bun index.ts --render=images                    # all reference pictures
bun index.ts --render=videos                    # all clips
bun index.ts --render=final                     # only assemble the final video from the rendered clips
bun index.ts --render=images,videos             # any combination - always in the order images, videos, final
bun index.ts --render=videos --only=slot-001    # only the listed clips (comma separated)
```

The planning steps run as usual first (cached ones are skipped), so the renders always use the current story, looks
and clip prompts. `--only` limits the clips that are rendered; the final video always needs all clips.

Typical order:

1. `bun index.ts` - plan, then check the story, beats and look prompts.
2. `bun index.ts --render=images` - render the pictures, look at them in `assets/`, delete the ones you don't like
   and run again until the cast looks right.
3. `bun index.ts --render=videos --only=slot-001,slot-012` - try a few clips.
4. `bun index.ts --render=all` - render the remaining clips and assemble `final.mp4`.

Or everything in one go: `bun index.ts --render=all`.

## Project config (`config.json`)

Every project can have a `projects/<project-id>/config.json`. All fields are optional - missing fields use the default.

```json
{
  "singers": [],
  "lyricsLanguage": "en",
  "seed": -1,
  "imageResolution": -1,
  "videoResolution": -1,
  "imageWorkflow": "krea2-image",
  "videoWorkflow": "h3-ref2video",
  "songAudio": true,
  "llm": {}
}
```

| Field             | Default          | Values                                                                                  |
|-------------------|------------------|-----------------------------------------------------------------------------------------|
| `llm`             | `{}`             | `{"model": "…"}` = another model of the LLM server for this project - the server and key come from the [settings](../README.md#setup) |
| `seed`            | `-1`             | `-1` = a new random seed for every render, `0` or more = fixed                          |
| `imageResolution` | `-1`             | see [Resolution](#resolution)                                                           |
| `videoResolution` | `-1`             | see [Resolution](#resolution)                                                           |
| `imageWorkflow`   | `"krea2-image"`  | a file name in `comfy/workflows/`, without `.ts`                                        |
| `videoWorkflow`   | `"h3-ref2video"` | a file name in `comfy/workflows/`, without `.ts`                                        |
| `songAudio`       | `true`           | final video: `true` = the original song as soundtrack, `false` = the clips' own audio   |
| `singers`         | `[]`             | who sings on screen: `[]` = nobody (clip mode), `["auto"]` = the LLM picks, `["Thorin"]` = names or ids - see [Singing characters](../README.md#singing-characters) |
| `lyricsLanguage`  | `"en"`           | language code of the lyrics, for Whisper and the `<d>[English]` lyrics tag               |
| `alignLyrics`     | `true` with singers, else `false` | stems, transcript and real lyric timing                                 |

The planning fields (`singers`, `lyricsLanguage`, `alignLyrics`) change the plan, the others only the render. The
config is read and checked at every run - a wrong value stops with a message naming the field, an unknown field
(a typo like `"singer"`) gets a warning.

### Seed

- `-1` picks a new random seed for every picture and every clip. The seed actually used is saved next to the file (see
  [Files a render produces](#files-a-render-produces)), so a result you like can be reproduced.
- A fixed number uses the same seed for every render. That gives comparable results when you change a prompt or the
  resolution, but every character and clip starts from the same noise.

To reproduce a single result: copy the seed from its `.json` file into `config.json`, delete the file and render it
again.

### Resolution

`imageResolution` and `videoResolution` accept three kinds of value:

| Value              | Meaning                                  | How it is built in the workflow                                 |
|--------------------|------------------------------------------|-----------------------------------------------------------------|
| `-1`               | the workflow's own size                  | the size the workflow was designed with                         |
| a number, e.g. `1.1` | megapixels                             | a `ResolutionSelector` node (16:9 or 9:16, multiples of 32)     |
| `"WIDTHxHEIGHT"`, e.g. `"1920x1088"` | a fixed size           | two `PrimitiveInt` nodes, connected to the width and height inputs |

The orientation is fixed per kind of render, whichever way round the size is written:

| Render     | Orientation | `-1` means            | `1.1` means        | `"1920x1088"` means |
|------------|-------------|-----------------------|--------------------|---------------------|
| characters | portrait    | 1088×1920             | 1.1 MP at 9:16     | 1088×1920           |
| locations  | landscape   | 1920×1088             | 1.1 MP at 16:9     | 1920×1088           |
| videos     | landscape   | 1.1 MP at 16:9        | 1.1 MP at 16:9     | 1920×1088           |

`"1088x1920"` and `"1920x1088"` therefore mean the same. Sizes should be multiples of 32 for H3; megapixel values are
rounded to multiples of 32 by the `ResolutionSelector` node.

Video frame rate is always 24 fps.

### Song audio

`songAudio` decides the soundtrack of `final.mp4`:

- `true` (default): the original `song.wav` is laid under the whole video and replaces whatever audio came back
  with the clips. Best quality, and the audio is exactly the song you put in.
- `false`: the clips' own audio tracks are cut to the same frames as the video and joined. Use this if a video
  workflow generates or changes audio that should be heard - e.g. sound effects or a model-generated vocal.

Both are frame-exact - see [below](#the-final-video-and-frame-exact-timing).

### Workflows

`imageWorkflow` and `videoWorkflow` pick the workflow file used for rendering. The included ones are `krea2-image` and
`h3-ref2video`. Any file in `comfy/workflows/` that follows the workflow contract can be used - see
[custom-workflows.md](custom-workflows.md). Different projects can use different workflows.

## What happens during a render

**A picture:**

1. If `assets/<characters|locations>/<id>.png` exists, it is skipped.
2. The image workflow is built with the picture's Krea 2 prompt (from `output/assets.json`), the seed, the resolution
   and the orientation.
3. The job is queued on the first free ComfyUI server; the status line shows its progress.
4. The saved PNG is downloaded to `assets/…/<id>.png`.

**A clip:**

1. If `videos/<clip-id>.mp4` exists, it is skipped.
2. If one of the clip's pictures is missing in `assets/`, the clip is skipped with a warning.
3. The clip's pictures and the full `song.wav` are uploaded to the server's `input/feverslop-ts/<project-id>/` folder.
4. The video workflow is built from `output/clips/<clip-id>.json`: the prompt, the pictures in `<Picture N>` order, the
   clip's first frame and frame count, the seed and the resolution - see
   [frame-exact timing](#the-final-video-and-frame-exact-timing).
5. The job is queued; the MP4 is downloaded to `videos/<clip-id>.mp4`. Its frame count is checked - a clip with fewer
   frames than it needs gets a warning.

In the included H3 workflow the song is trimmed to the clip inside the graph (`TrimAudioDuration`), and that trimmed
audio is the reference audio, the audio guide and the soundtrack of the MP4 at the same time.

**A clip with a singer** (performance mode) also uploads `stems/vocals.wav` as `feverslop-ts/<project-id>/vocals.wav`.
The workflow trims it to the same start and length as the song and feeds it in as the second reference audio
(`<Audio 2>`, `ref_audios.ref_audio_1`) - the voice the singer's lips follow. The audio guide and the MP4's
soundtrack stay on the full mix. A clip with a singer is skipped with a warning if the vocals stem is missing.

**The final video** (`--render=final`):

1. Every clip must exist in `videos/`, with at least the frames it needs - otherwise it stops and lists the missing
   ones.
2. Every clip is cut to exactly its frames, from its first frame on; the extra frames at the end are dropped.
3. All clips are joined in order, scaled to the size of the first clip if the sizes differ.
4. The soundtrack is added: the original song (`"songAudio": true`) or the clips' own audio, cut to the same frames.
5. The result is checked: it must have exactly as many frames as the song, and is saved as `final.mp4`.

### Several servers

With more than one ComfyUI server in the settings, the renders are spread over them:

1. At the first render, every server is asked for `/system_stats` (5 s timeout). Unreachable ones get a warning and
   are left out for this run; if none answers, the run stops and lists them.
2. All pictures start at once, and each takes the first free server - **one job per server at a time**, the rest wait
   (`N queued` on the status line). The clips start when all pictures are done, the same way. The final video comes
   after all clips.
3. The status line shows all running jobs, e.g.
   `⠋ 2 running · clip slot-003 @gpu1 running KSampler #3, step 4/8 · clip slot-004 @gpu2 queued · 1 queued`, and
   every `Rendering`, `Resuming` and `Saved` line names the server.
4. If one render fails, the others run to the end; the run stops afterwards with the errors.

Each server gets its own client id, `feverslop-ts-<project-id>-<name>` - stable, so the progress of a resumed job still
arrives after a restart. A job's `.pending.json` records its server (name and URL), and a resumed job waits for exactly
that server. If that server is gone from the settings or doesn't answer, the file is rendered again on another one (with
a warning); the old job, if it is still running, finishes on its own. Pending files from before several servers have
no server - they are resumed on the first one.

Several servers can also be one machine with several GPUs - one ComfyUI instance per GPU, each on its own port
(`--cuda-device 1 --port 8189`). The same server listed twice doesn't render faster: ComfyUI runs its queue one job at
a time.

## The final video and frame-exact timing

For lip-sync, every frame of the final video has to be at exactly the moment of the song that it was generated for.
Three things make that hard: clip boundaries are beat times, not frame times; the H3 node only renders certain
lengths (5 + 17·k frames), so a clip always comes back a bit longer than asked; and rounding every clip on its own
adds up over 30+ clips. FeverSlop TS solves it with one frame grid for the whole song.

**1. One frame grid.** The song is divided into frames at 24 fps (frame 0 is the start of the song). Every clip owns a
range of it: it starts at frame `round(start × 24)` and ends where the next clip starts. The ranges follow each other
without gaps or overlaps, so the clips always add up to exactly the song's frame count - rounding never accumulates.
`output/clips/<clip-id>.json` lists each clip's `frameStart` and `frames`.

**2. Rendering longer, with the real song.** The workflow's `renderFrames()` rounds the clip's frames up to a length
the model accepts. The audio given to the model starts exactly on the clip's first frame (`frameStart / 24` seconds)
and covers the whole render length - so the extra frames at the end also move to the real song, not to silence.

**3. Cutting back.** When assembling, every clip is cut to its own frame count from frame 0 on. Frame 0 of a clip was
generated for the audio at `frameStart`, and in the final video it sits at frame `frameStart` - so every frame is back
at the moment of the song it was made for, and the original song can be laid under the whole video unchanged.

Example, a 9.22 s slot starting at 0:00:

| | frames | seconds |
|---|---|---|
| the clip needs (on the grid) | 221 | 9.208 |
| H3 renders (5 + 17·k) | 226 | 9.417 |
| audio given to the model | from 0.000 s, 9.417 s long | |
| kept in the final video | frames 0–220 | 9.208 |
| the next clip starts at | frame 221 | 9.208 s |

The `.json` next to every clip records `frameStart`, `frames` (used in the final video) and `renderedFrames`.

## Files a render produces

In the project:

```
projects/<project-id>/
  assets/
    characters/<id>.png        rendered character reference sheet (portrait)
    characters/<id>.png.json   how it was made
    locations/<id>.png         rendered location (landscape)
    locations/<id>.png.json
    clips/slot-001_ff.png      the clip's first frame in the final video
    clips/slot-001_lf.png      the clip's last frame in the final video (frame frames-1, not the file's last)
  videos/
    slot-001.mp4               rendered clip, full render length, with its part of the song as audio
    slot-001.mp4.json
  final.mp4                    the assembled music video
```

The `.json` next to each clip records how it was made:

```json
{
  "workflow": "h3-ref2video",
  "seed": 181504938271,
  "resolution": -1,
  "frameStart": 0,
  "frames": 221,
  "renderedFrames": 226,
  "size": "<width>x<height>",
  "request": "output/clips/slot-001.json"
}
```

Pictures record the workflow, seed, resolution and prompt.

Every clip also leaves its **boundary frames** in `assets/clips/`: `<clip-id>_ff.png` (frame 0) and `<clip-id>_lf.png`
(frame `frames - 1`) - the first and last frame the clip contributes to `final.mp4`, not the padding the model
renders past it. They are the preparation for extending or bridging clips later with a first-/last-frame workflow
(fflf2va). They are saved right after a clip is downloaded; clips rendered before get theirs on the next
`--render=videos` run. A clip rendered again rewrites its frames.

`final.mp4` is H.264 (CRF 18) at 24 fps with AAC audio at 320 kbit/s. Unlike pictures and clips it is rebuilt every
time `--render=final` runs - it's always made from the current clips.

On the ComfyUI server, under the `feverslop-ts/<project-id>/` subfolder of its `input/` (uploads) and `output/`
(results) folders.

## Re-rendering

Nothing that exists is ever overwritten - this protects pictures and clips you're happy with, and pictures you made
yourself.

- **One picture or clip:** delete the file (and its `.json`) and render again.
- **All pictures:** delete `assets/characters/` and `assets/locations/`.
- **After changing a look prompt:** the picture is *not* re-rendered automatically - delete it.
- **After changing the story or beats:** the clip prompts in `output/clips/` change, but existing videos stay - delete
  the clips that should change.

Your own pictures work too: save them under the same names in `assets/` and they are used as they are.

## Node types (`comfy/nodes.ts`)

`comfy/nodes.ts` is a typed `WorkflowBuilder` with one method per installed node, generated from the server's node
list (`/object_info`) by the SDK's `cfli codegen`, called from `comfy/gen-types.ts`. The real model file names,
samplers and schedulers are its allowed values. That's what makes a missing model, a misspelled sampler or a wrong
connection a type error instead of a failed render.

Regenerate it whenever the server changes:

```bash
bun run comfy:types     # the first server of the settings, or: bun run comfy:types --comfy=http://host:8188
bun run typecheck
```

## Things to know

**The ComfyUI client is the ComfyUI SDK.**
Rendering uses [`@saintno/comfyui-sdk`](https://github.com/comfy-addons/comfyui-sdk): `ComfyApi` for the connection,
uploads and downloads, and its generated `WorkflowBuilder` for the workflows. Spreading jobs over several servers is
done by FeverSlop TS itself (`lib/render.ts`), not by the SDK's `ComfyPool`: the pool frees a server only on WebSocket
events, so a resumed job that finished while FeverSlop TS was stopped would block its server forever - and its job loop
never ends, so the process wouldn't exit.

**`comfy/gen-types.ts` fixes two things in the generated code.**
Some custom nodes have several outputs with the same name (e.g. two `FLOAT`s) - in the generated code only the last one
would be reachable, and the file wouldn't type-check. `cfli codegen` always reads the node list from a server, so
`comfy/gen-types.ts` runs it against a small local proxy that numbers such outputs (`FLOAT`, `FLOAT_2`) and keeps
inputs declared both required and optional as required. It also splits the generated imports into value and type
imports, which this project's TypeScript config requires. `comfy/json-to-ts.ts` uses the same cleanup
(`comfy/node-list.ts`), so converted workflows use the same output names.

**Widgets connected to node outputs, autogrow inputs and format-dependent widgets aren't in the types.**
The generated types allow only plain values for widgets, and don't know autogrow inputs (`ref_images.ref_image_0`, …)
or widgets that only exist for some settings (`VHS_VideoCombine`'s `crf`, `pix_fmt`). The helpers `widget()` and
`withInputs()` cover these - see [custom-workflows.md](custom-workflows.md#helpers).

**Renders can take as long as they take.**
A MiniMax clip can render for an hour or more on slower GPUs (e.g. Radeon cards). There is no time limit anywhere:
FeverSlop TS checks the server's history every 5 seconds until the job is done, so completion doesn't depend on the
WebSocket at all. The WebSocket only feeds the progress shown on the status line (current node and sampling step, and
how many jobs are queued ahead). If the connection drops - ComfyUI sends nothing while it loads a large model, or the
network hiccups - the status line says so, the SDK reconnects, and the job simply keeps going on the server.

**Jobs survive a stopped FeverSlop TS.**
When a job is queued, its id is written to `<file>.pending.json` next to the file it will produce (e.g.
`videos/slot-007.mp4.pending.json`). If FeverSlop TS stops while ComfyUI is still rendering - Ctrl+C, a crash, the PC
going to sleep - the job keeps running on the server, and the next run with `--render` attaches to it instead of
rendering again: it waits for it if it's still running, or downloads the result right away if it finished in the
meantime. Its seed is kept. Only if the server no longer knows the job (e.g. ComfyUI was restarted, which clears its
queue and history) is it rendered again. Downloads go to a temporary `.download` file first, so an interrupted
download never looks like a finished clip.

**`comfy/nodes.ts` is large.**
It has a method and a few types for every installed node (about 4.3 MB for ~2,500 nodes). It's generated - never edit
it by hand, and leave it out of version control (add it to `.gitignore`); everyone regenerates it against their own
server.

**Clips are rendered slightly longer than their slot.**
The H3 node only renders 5 + 17·k frames, so the frame count is rounded up: an 8.5 s slot renders 209 frames
(8.71 s), a full 10 s slot 243 frames (10.13 s). The extra frames are cut off again in `final.mp4` - see
[frame-exact timing](#the-final-video-and-frame-exact-timing). The files in `videos/` keep the full render length. If
your hardware can't render more than 10 s, set `MAX_CLIP_SEC` in `index.ts` a little lower - the rounding needs up to
16 extra frames (0.67 s).

**The second audio input is the vocals stem, only for clips with a singer.**
`comfy/r2v_audio_fullmix_guide_1-pass_turbo.json` feeds a second reference audio in (`ref_audios.ref_audio_1`). The
rebuilt workflow only connects it for clips with a singer, with the isolated vocals of the clip as `<Audio 2>` - the
prompt defines it as the singer's voice-timbre reference. Clips without a singer only have `<Audio 1>`.

**Model names are fixed in the workflow files.**
The workflows name their models explicitly, as in the original JSON. To use another checkpoint or LoRA, change it in
the workflow file (or copy the file under a new name and point `config.json` at it); `bun run typecheck` tells you if
the file exists on the server.

**Lip-sync needs aligned lyrics.**
The sung lines are placed at the times from `lyricsTiming` in `project.json`. If a singer's mouth moves at the wrong
moment, check that line's time first (the run prints a table with confidences) and fix it by hand, then
`--redo=timeline` and render the clip again. Lines with low confidence have interpolated times.

**Uploads and results pile up on the server.**
Every render uploads its pictures and the song to `input/feverslop-ts/<project-id>/` and saves its result under
`output/feverslop-ts/<project-id>/`. Uploads of the same file overwrite each other, but results are kept. Clean these
folders on the server when a project is done.

**Rendering runs one job per server at a time.**
With one server, pictures and clips are rendered one after another; with several, in parallel - see
[Several servers](#several-servers). A render can be stopped with Ctrl+C at any time; finished files are kept, running
jobs are picked up again by the next run (see above). To really cancel a job, cancel it in the ComfyUI queue of its
server (named in its `.pending.json`) and delete the `.pending.json`.

**All servers need the same models and nodes.**
A job can land on any server, and `comfy/nodes.ts` - which the workflows are checked against - is generated from the
first one. A model missing on one server makes the jobs there fail.

**A resumed job stays on its server.**
Resuming works across restarts and across changes to the server list, as long as the job's server is still in the list
under the same URL or name. Changing both its URL and its name makes its pending jobs start over.

## Troubleshooting

| Problem                                                    | Cause and fix                                                                                                                          |
|------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| `No ComfyUI server reachable (…)`                          | None of the servers answered - start ComfyUI, or check the list and each server's status with `bun run setup comfy`.                   |
| `ComfyUI <name> (<url>) is unreachable - …`                | That server is left out of this run, the others render. `401`/`403`: a wrong or missing token or password.                             |
| `…: its job was queued on <name> (<url>), which is unreachable` / `is no longer configured` | The job's server is down or gone from the settings - the file is rendered again on another server. |
| `No LLM server configured`                                 | Run `bun run setup llm`, or set `FEVERSLOP_LLM_URL` / `--llm-url=`.                                                                   |
| `Several models on <url> (…) - pick one`                   | The LLM server has more than one model - pick one with `bun run setup llm-model` (or `--llm-model=`, or `"llm": {"model": …}` in `config.json`). |
| `The LLM server <url> has no model "…"`                    | The configured model isn't loaded on the server (any more) - pick another with `bun run setup llm-model`.                              |
| `config.json: imageResolution must be …`                   | A wrong value in `config.json` - see [Resolution](#resolution).                                                                        |
| `config.json: videoWorkflow: no workflow comfy/workflows/…` | The workflow name has a typo, or the file is missing.                                                                                  |
| `clip slot-003 skipped - missing pictures: …`              | Render the pictures first (`--render=images`) or put your own under the listed names.                                                  |
| `ComfyUI job failed - …`                                  | ComfyUI rejected or aborted the job - usually a model or node that isn't installed. Run `bun run comfy:types` and `bun run typecheck`; the ComfyUI console shows the details. |
| `typecheck` shows errors in `comfy/nodes.ts`              | A custom node with a definition the generator can't handle - see "`comfy/gen-types.ts` fixes two things" above; a new kind of problem needs a fix in `comfy/node-list.ts`. |
| `the job disappeared from <server> (restarted?)`          | ComfyUI was restarted while the job was queued or running. Run again - it is rendered again.                                            |
| `the job queued at … is no longer on <server> - rendering again` | Same, noticed at the start of a run: the old job is gone, a new one is queued.                                                 |
| `Can't assemble - N clip(s) not rendered yet`              | Render the missing clips first: `--render=videos` or `--render=all`.                                                                   |
| `videos/slot-XXX.mp4 has N frames, but the clip needs M`   | The clip was rendered too short (e.g. with an old workflow or changed timeline) - delete it and render it again.                       |
| Lips are off in `final.mp4`                                 | Check that the clip's `.json` has the same `frameStart` / `frames` as `output/clips/<id>.json` - if the timeline changed after the render, delete and re-render the clip. |
| `the output node saved no .png file` (or `.mp4`)           | The workflow's `output` node isn't the node that saves the file, or it saves a different file type - see [custom-workflows.md](custom-workflows.md#the-output-node). |
