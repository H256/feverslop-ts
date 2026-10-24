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

2. **The models and custom nodes the workflows use.** The included workflows need:

   | Workflow                          | Models                                                                                                                                                                                                              | Custom nodes                                               |
   |-----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
   | `kroma-image` (pictures, default) | `kroma-v0.3.1-turbo-opd.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors`, `qwen_image_vae.safetensors`                                                                                                             | `SeedNode`, `SaveImageAdvanced`, `VRAMCleanup`                                          |
   | `krea2-image` (pictures)          | `krea2_turbo_fp8_scaled.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors`, `qwen_image_vae.safetensors`                                                                                                             | `VRAMCleanup`                                               |
   | `h3-ref2video` (clips)            | `minimax_h3_ref2va_pruned_int8_convrot.safetensors`, `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` (LoRA), `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`, `minimax_h3_video_vae_fp16.safetensors`, `minimax_h3_audio_vae_fp32.safetensors` | `VHS_VideoCombine`, `VRAMCleanup`                           |
   | `h3-sequence-to-sheet` (reference sheets) | `minimax_h3_fl2va_pruned_int8_convrot.safetensors`, `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` (LoRA), `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`, `minimax_h3_video_vae_fp16.safetensors` | `VHS_VideoCombine`, `VRAMCleanup`                           |

   All three workflows also use ComfyUI's built-in `Model Attention Backend` node set to `comfy kitchen attention`
   (needs a ComfyUI with the `comfy-kitchen` package). On the Radeon it cuts MiniMax H3 sampling by about 25%;
   on Krea2 the gain is smaller and untested, and the output changes slightly. To turn it off, set the node's
   `attention` to `'pytorch attention'` in the workflow file.

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
4. `bun index.ts --render=all` - render the remaining clips and assemble `<project-id>.mp4`.

Or everything in one go: `bun index.ts --render=all`.

## Project config (`config.json`)

Every project can have a `projects/<project-id>/config.json`. All fields are optional - missing fields use the default.

```json
{
  "singers": [],
  "singerVoice": "auto",
  "lyricsLanguage": "en",
  "seed": -1,
  "imageResolution": -1,
  "videoResolution": -1,
  "imageWorkflow": "kroma-image",
  "videoWorkflow": "h3-ref2video",
  "songAudio": true,
  "sequenceSheets": true,
  "sequenceWorkflow": "h3-sequence-to-sheet",
  "llm": {}
}
```

| Field             | Default          | Values                                                                                  |
|-------------------|------------------|-----------------------------------------------------------------------------------------|
| `llm`             | `{}`             | `{"model": "…"}` = another model of the LLM server for this project - the server and key come from the [settings](../README.md#setup) |
| `seed`            | `-1`             | `-1` = a new random seed for every render, `0` or more = fixed                          |
| `imageResolution` | `-1`             | see [Resolution](#resolution)                                                           |
| `videoResolution` | `-1`             | see [Resolution](#resolution)                                                           |
| `imageWorkflow`   | `"kroma-image"`  | a file name in `comfy/workflows/`, without `.ts` - `"krea2-image"` for the previous one |
| `videoWorkflow`   | `"h3-ref2video"` | a file name in `comfy/workflows/`, without `.ts`                                        |
| `videoAspect`     | `"16:9"`         | the clips' aspect ratio - `"9:16"` for portrait clips, or any ratio like `"2:1"`, `"2:3"`; see the table below |
| `finalFps`        | `24`             | `60` (or 48, 30, …): a second final video at that rate, the clips interpolated shot by shot (`comfy/workflows/frame-interpolate.ts`, ComfyUI's own `FrameInterpolate`) |
| `finish`          | `false`          | `true` or `{"sharpen": 0.3, …}`: a light grade (levels, contrast, saturation) and CAS sharpen of the final video(s), as `<name>-finished.mp4` next to them; with `colorMatch`/`colorReference` the clips matched to one reference first, with `grain` film grain last - ffmpeg only, no ComfyUI (`lib/finish.ts`, `lib/colormatch.ts`) |
| `interpolationModel` | `"rife_v4.26_heavy.safetensors"` | a file in `models/frame_interpolation/` - RIFE 4.25/4.26 or `film_net_fp16.safetensors`, from Hugging Face `Comfy-Org/frame_interpolation`; on every server that renders |
| `songAudio`       | `true`           | final video: `true` = the original song as soundtrack, `false` = the clips' own audio   |
| `sequenceSheets`  | `true`           | `true` = every character/location gets a multi-angle reference sheet instead of one flat hero image - see [Reference sheets](#reference-sheets); `false` = the old single-picture render |
| `sequenceWorkflow`| `"h3-sequence-to-sheet"` | a file name in `comfy/workflows/`, without `.ts`                                |
| `pinStartFrame`   | `true`           | continuing clips (README: [Continuous scenes](../README.md#continuous-scenes)): `true` = the clip is locked to the last frame of the clip before it as its real first frame (`MiniMaxH3AddGuide` with `image`, `h3-ref2video` only), `false` = that frame is only one of the reference pictures |
| `contextFrames`   | `0`              | `22` or `39`: a continuing clip gets the last frames of the clip before as a frame batch, locked to its start (`MiniMaxH3AddGuide` at frame 0, ComfyUI's own nodes); rendered that much longer, the head cut off again (`lib/render.ts`, `trimHead`). Instead of the one pinned frame |
| `fightClips`      | `false`          | `true` = the clips of a fight beat (kind `hit` with a crowd of creatures in it) are cut into one-bar pieces of about two seconds, one shot each, and a piece has only the people of its shot as references - more clips, shorter, and the opponent is always in the picture. The planner stages such a beat as single blows and reactions (`micro`). Changing it redoes `blocking` (and so `shotMoments`) |
| `leakRetries`     | `0`              | a rendered clip that came out as the reference pictures lined up on their grey studio backdrop (seed-dependent, rare) is put away in `old/leaks/` and rendered again with another seed, up to this many times. `0` = off. Needs `"seed": -1`. `bun run leak-scan <project-id>` looks through the clips already rendered and prints the command to render the flagged ones again |
| `songWorkflow`    | `"yue2-song"`    | `--render=song`: a file name in `comfy/workflows/`, without `.ts` |
| `songDuration`    | `-1`             | `--render=song`: an upper bound in seconds for the generated song, `-1` = the workflow's own (360 s) |
| `continuity`      | `"never"`        | `"auto"` = the beats marked continuous run on without a cut, `"always"` = every clip but the first of each beat starts on the last frame of the one before - read [Continuous scenes](../README.md#continuous-scenes) first. Changing it redoes `blocking` |
| `locationView`    | `"auto"`         | which view of a place's reference sheet a clip gets: `"auto"` = chosen per shot (step `shotViews`), `-1` = the whole sheet, `0`-`4` = front, right, behind, left, wide for every clip. Needs `sequenceSheets` |
| `singers`         | `[]`             | who sings on screen: `[]` = nobody (clip mode), `["auto"]` = the LLM picks, `["Thorin"]` = names or ids - see [Singing characters](../README.md#singing-characters) |
| `singerVoice`     | `"auto"`         | voice of the song: `"auto"` = as the story has it, `"female"` / `"male"` = everybody who sings is a woman / man, `"mixed"` = a duet of one woman and one man; the story is written around them and the cast follows (changes the story, so everything after it redoes) |
| `lyricsLanguage`  | `"en"`           | language code of the lyrics, for Whisper and the `<d>[English]` lyrics tag               |
| `alignLyrics`     | `true` with singers, else `false` | stems, transcript and real lyric timing                                 |

Changing `singerVoice` after pictures were rendered: existing pictures are kept (a picture that exists is not rendered again), so delete the old character pictures to get the new cast.

The planning fields (`singers`, `singerVoice`, `lyricsLanguage`, `alignLyrics`, `continuity`, `locationView`, `fightClips`) change the plan, the others only the render. The
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
| a number, e.g. `1.1` | megapixels                             | computed by the pipeline (16:9 or 9:16, multiples of 32, as ComfyUI's `ResolutionSelector`), two `PrimitiveInt` nodes |
| `"WIDTHxHEIGHT"`, e.g. `"1920x1088"` | a fixed size           | two `PrimitiveInt` nodes, connected to the width and height inputs |

The orientation is fixed per kind of render, whichever way round the size is written - for videos it follows `videoAspect`:

| Render     | Orientation | `-1` means            | `1.1` means        | `"1920x1088"` means |
|------------|-------------|-----------------------|--------------------|---------------------|
| characters | portrait    | 1088×1920             | 1.1 MP at 9:16     | 1088×1920           |
| locations  | landscape   | 1920×1088             | 1.1 MP at 16:9     | 1920×1088           |
| videos     | landscape   | 1.1 MP at 16:9        | 1.1 MP at 16:9     | 1920×1088           |
| videos, `"videoAspect": "9:16"` | portrait | 0.4 MP at 9:16 | 1.1 MP at 9:16 | 1088×1920 |
| videos, `"videoAspect": "2:3"`  | portrait | 0.4 MP at 2:3  | 1.1 MP at 2:3  | 1088×1920 (its own ratio, turned upright) |

`"1088x1920"` and `"1920x1088"` therefore mean the same. Sizes should be multiples of 32 for H3; megapixel values are
rounded to multiples of 32. The pipeline computes the size itself, not a node on the server: with several servers every
one renders the same size, and a clip that comes out at another size is put away in `old/attempts/` and fails instead of
being scaled in the final video.

`kroma-image` renders in two passes and saves twice the size it samples at: its `-1` is a 544×960 first pass,
scaled up 2× to 1088×1920 (characters; 1920×1088 for locations), and `imageResolution` sets the size of the first
pass - `"1088x1920"` gives a 2176×3840 picture.

`h3-ref2video-2pass` is the other way round: `videoResolution` is the **final** size, and the first pass renders half
its width and half its height - a quarter of the pixels; the latent upscaler brings it to the final size. To pick the
first pass, give four times its megapixels:

| `videoResolution` | pass 1 | final | measured (8 s clip, 192 frames) |
|-------------------|--------|-------|---------------------------------|
| `-1` or `2`       | 960×544 (0.5 MP) | 1920×1088 | RTX 5090: pass 1 2:35, pass 2 2:20 - 6:47 in all; Radeon R9700: 16:45 (both with the old pass 2 of 2 turbo steps; pass 2 now has 4 steps - about 22 s each on the 5090 at 2 MP for a 4 s clip, about 3 min each on the R9700) |
| `2.4`             | 1056×592 (0.6 MP) | 2112×1184 | not measured |
| `1.2`             | 768×416 (0.3 MP) | 1504×832 | not measured |

Pass 2 at the final size is the expensive part: at 2 MP the UNet no longer fits next to the activations of a 32 GB card
and is partly moved to RAM (70 s per step on the 5090, 172 s on the R9700), so a larger final size costs a lot more
time and may not fit on the Radeon at all. A first pass at another size than half the final one (0.6 MP before a
2 MP clip) is not possible yet - the upscaler always doubles.

Video frame rate is always 24 fps.

### Song audio

`songAudio` decides the soundtrack of the final video:

- `true` (default): the original `song.wav` is laid under the whole video and replaces whatever audio came back
  with the clips. Best quality, and the audio is exactly the song you put in.
- `false`: the clips' own audio tracks are cut to the same frames as the video and joined. Use this if a video
  workflow generates or changes audio that should be heard - e.g. sound effects or a model-generated vocal.

Both are frame-exact - see [below](#the-final-video-and-frame-exact-timing).

### Reference sheets

With `sequenceSheets` on (the default), every character and location picture (`assets/characters/*.png`,
`assets/locations/*.png` - what every clip actually references) is built from several angles instead of one flat
hero image:

1. The usual look prompt renders a hero image, saved as the "anchor" (`assets/sequence/<kind>s/<id>/anchor.png`).
2. The anchor is turned into a short silent turnaround video with `sequenceWorkflow` (6 hard-cut views for a
   character - front, face, left/right profile, rear, an expression change; 5 for a location - front, right, rear,
   left, wide establishing), saved as `assets/sequence/<kind>s/<id>/sequence.mp4`.
3. One frame per view is sampled from that video (`assets/sequence/<kind>s/<id>/frames/`) and composited into the
   final multi-angle reference sheet - the file every clip's `<Picture N>` actually resolves to.

This gives a video model more to draw a shot's framing from than one static establishing shot, and - for a group
character (see [README → Group characters](../README.md#group-characters)) - each member gets its own such sheet.
Set `"sequenceSheets": false` to fall back to the old single-picture render (cheaper, one render per character/
location instead of two).

#### Using your own anchor image

Step 1 above is skipped whenever its file already exists - so to reuse an existing character or location instead of
generating a new one (e.g. carrying a character over from an earlier project, or supplying a face you already have),
drop your own image at:

```
projects/<project-id>/assets/sequence/characters/<character-id>/anchor.png
projects/<project-id>/assets/sequence/locations/<location-id>/anchor.png
```

A group character's members live at `<character-id>-v0`, `<character-id>-v1`, ... (`characterId-v<N>`, see
[README → Group characters](../README.md#group-characters)) - supply one `anchor.png` per member you want to fix,
same path pattern.

Create the `assets/sequence/<kind>s/<id>/` folder yourself if it doesn't exist yet (nothing has rendered for that id
before), then run `--render=images` as usual: it turns your anchor into the turnaround video and reference sheet
exactly as it would for a freshly generated one, uploading it to ComfyUI like any other reference image. Skipping
step 1 this way leaves no `anchor.png.json` next to it (that file only gets written when this project renders the
anchor itself) - harmless, it's only ever read for the debug record of how a file was made.

One thing to watch: the turnaround video's prompt still describes the character/location from this project's own
generated text description (`characterDescriptions`/`locationDescriptions` in `project.json`), not from the image
itself - a supplied anchor that looks very different from what that text says invites the same kind of
identity-drift the video model shows when its picture and its prompt disagree (see the description-vs-picture fix
in [PR #8](https://forgejo.elysium.lan/H256/feverslop-ts/pulls/8)). If you're carrying a character over into a
different story, it's worth checking - and if needed editing by hand - that project's `characterDescriptions` entry
so it actually matches the image you dropped in, before rendering.

**`bun run replace-character <project-id>`** does all of this for a character interactively instead of by hand: pick
the character (and, for a group, which member), point it at your image file, and it copies the image in, clears
whatever was built from the old one, and offers to update the description from it with a vision-capable LLM (or by
typing it yourself) - directly addressing the caveat above - before optionally rendering the new sheet right away.
See [replace-character](#replace-character) below.

To force a full or partial re-render later, see [Re-rendering](#re-rendering) below - what to delete depends on
whether you want to keep your anchor or replace it too.

#### replace-character

```bash
bun run replace-character <project-id>
```

Interactive (needs a terminal - see [Creating a project](../README.md#creating-a-project) for the same style of
wizard). Walks through:

1. **Character** - pick from the project's cast; a group character (see
   [README → Group characters](../README.md#group-characters)) also asks which member.
2. **Image** - a path to any image ffmpeg can read; it's converted to the plain PNG every path here expects and saved
   as the anchor (`sequenceSheets: true`) or directly as the final picture (`sequenceSheets: false`). Whatever a
   sequence sheet had already built from the old anchor (`sequence.mp4`, its sampled frames, the composited sheet) is
   cleared, so it's rebuilt from the new one.
3. **Description** - three options: generate it from the image with a vision-capable LLM, type it yourself, or leave
   the current one unchanged. A vision request is downsized to 512px wide first - a full-resolution reference
   picture (1000px+) made a real local vision model take minutes per request or never return at all; the much
   smaller request came back in well under a minute in testing. A vision attempt that errors (e.g. the connected
   model doesn't support images) falls back to asking you to type one instead.
4. **Already-rendered clips** - any `videos/<clip-id>.mp4` already made with the old picture is listed, not deleted -
   review and delete the ones you want redone yourself.
5. **Render now?** (only with `sequenceSheets: true`) - renders the updated sheet immediately, or leaves it for the
   next `--render=images`.

### Workflows

`imageWorkflow`, `videoWorkflow` and `sequenceWorkflow` pick the workflow file used for rendering. The included ones
are `kroma-image` (default) and `krea2-image` for pictures; `h3-ref2video` (default), `h3-ref2video-full`,
`h3-ref2video-2pass` and `h3-ref2video-cpu-clip` for clips; `h3-sequence-to-sheet` for the reference sheets and
`yue2-song` for the song (see the table in the [README](../README.md#workflows)). `frame-interpolate` is used for
`finalFps` and is not chosen in `config.json`. Any file in `comfy/workflows/` that follows the
workflow contract can be used - see [custom-workflows.md](custom-workflows.md). Different projects can use different
workflows.

## What happens during a render

**A picture**, with `sequenceSheets: false` (see [Reference sheets](#reference-sheets) for the default, on, path):

1. If `assets/<characters|locations>/<id>.png` exists, it is skipped.
2. The image workflow is built with the picture's Krea 2 prompt (from `output/assets.json`), the seed, the resolution
   and the orientation.
3. The job is queued on the first free ComfyUI server; the status line shows its progress.
4. The saved PNG is downloaded to `assets/…/<id>.png`.

With `sequenceSheets: true` (the default), steps 1-4 above still run first, but write to
`assets/sequence/<characters|locations>/<id>/anchor.png` instead of the final `assets/…/<id>.png` - then:

5. If `assets/sequence/…/<id>/sequence.mp4` doesn't exist yet, the sequence workflow is built from the anchor image
   (`first_frame`), the deterministic turnaround prompt (`lib/sequenceSheet.ts`), the seed and the resolution, queued
   and downloaded there.
6. One frame per beat of that video is extracted with ffmpeg into `assets/sequence/…/<id>/frames/`.
7. Those frames are composited into the final `assets/…/<id>.png` - the file every clip's `<Picture N>` resolves to -
   with ffmpeg (`xstack`), no image library.

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
5. The result is checked: it must have exactly as many frames as the song, and is saved as `<project-id>.mp4`.

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
5. **A server that goes down in the middle of a run** (its ComfyUI crashed, the proxy answers "Bad Gateway"): after a
   failed job the server is asked for `/system_stats` again (10 s). If it does not answer, it is out for the rest of
   the run - one warning, no job goes to it any more, and the clip that failed is rendered again on another server.
   Before this, every following clip went to the dead server and failed at once (33 of 41 on tribal-261019). With no
   server left the run stops. A server that answers keeps the failure as a failure (a refused graph, a workflow error).

Each server gets its own client id, `feverslop-ts-<project-id>-<name>` - stable, so the progress of a resumed job still
arrives after a restart. A job's `.pending.json` records its server (name and URL), and a resumed job waits for exactly
that server. If that server is gone from the settings or doesn't answer, the file is rendered again on another one (with
a warning); the old job, if it is still running, finishes on its own. Pending files from before several servers have
no server - they are resumed on the first one.

When a run starts, the jobs an earlier run left on a server come first: before any clip is queued, the pending files
are read and each server is held for the jobs recorded on it - a new clip does not get it until they have taken it (or
turned out not to resume). A job that is already finished needs no free server at all: its result is downloaded at
once. Before this, a new clip could grab the server first, and a finished job waited behind it for hours.

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
    sequence/characters/<id>/  only with sequenceSheets: true (the default) - see Reference sheets
      anchor.png                 the hero image the turnaround video was made from
      sequence.mp4                the turnaround video
      frames/frame_00.png, …      one sampled frame per beat, composited into characters/<id>.png
    sequence/locations/<id>/   same, for a location
    clips/slot-001_ff.png      the clip's first frame in the final video
    clips/slot-001_lf.png      the clip's last frame in the final video (frame frames-1, not the file's last)
  videos/
    slot-001.mp4               rendered clip, full render length, with its part of the song as audio
    slot-001.mp4.json
  <project-id>.mp4             the assembled music video
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

With `sequenceSheets: false`, a picture's `.json` records the workflow, seed, resolution and prompt. With
`sequenceSheets: true` (the default), the anchor and the sequence video each get their own `.json` next to them in
`assets/sequence/…/<id>/` (same shape as a picture's / a clip's); the final composited sheet's `.json` records the
sequence workflow, frame count, beat timestamps and the turnaround prompt instead.

Every clip also leaves its **boundary frames** in `assets/clips/`: `<clip-id>_ff.png` (frame 0) and `<clip-id>_lf.png`
(frame `frames - 1`) - the first and last frame the clip contributes to the final video, not the padding the model
renders past it. They are the preparation for extending or bridging clips later with a first-/last-frame workflow
(fflf2va). They are saved right after a clip is downloaded; clips rendered before get theirs on the next
`--render=videos` run. A clip rendered again rewrites its frames.

`<project-id>.mp4` is H.264 (CRF 18) at 24 fps with AAC audio at 320 kbit/s. Unlike pictures and clips it is rebuilt every
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

Your own pictures work too: save them under the same names in `assets/` and they are used as they are (see
[Using your own anchor image](#using-your-own-anchor-image) to do the same for a sequence sheet's *anchor*
specifically, one step earlier).

**With `sequenceSheets: true`,** re-rendering a character/location is staged - each step is only redone if its own
file is missing, so deleting just the final picture reuses everything upstream of it instead of starting over:

| You delete                                                  | What gets redone                                      |
|---------------------------------------------------------------|--------------------------------------------------------|
| `assets/<kind>s/<id>.png` only                                 | just recomposited from the existing sampled frames      |
| … and `assets/sequence/<kind>s/<id>/frames/`                   | frames re-extracted from the existing video, then composited |
| … and `sequence.mp4` (`.json`)                                 | a new turnaround video, from the existing anchor          |
| … and the whole `assets/sequence/<kind>s/<id>/` folder          | a new anchor too - full re-render                        |

The final picture (`assets/<kind>s/<id>.png`) is what actually triggers this whole step - deleting only something
under `assets/sequence/…/<id>/` while leaving the final picture in place does nothing on the next render, since that
step is skipped entirely once the final picture exists.

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
(8.71 s), a full 10 s slot 243 frames (10.13 s). The extra frames are cut off again in the final video - see
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

Two things in the timeline and the prompt help the mouth:
- **No long silence inside a singing clip** (`vocalGap`, 1.5 s by default): "keep lips closed outside the span" does not
  hold when a clip opens on seconds of silence - the singing starts early. Such a clip is cut where the voice comes in,
  a long silent tail where it stops; the silence is rendered as a clip of its own.
- **Held notes:** a sung word of a second or more gets its own sentence in the shot - one open vowel shape held, only
  jaw and throat moving - or the mouth flaps open and shut on it. The length comes from `lyricsTiming`, nothing else.

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
| `… takes no pictures` / `… took no picture`                | Describing a picture went to a model without vision (llama-server without `--mmproj`) - name a vision model with `bun run setup vision` (`llm.vision` in the settings file, or `FEVERSLOP_VISION_URL` / `FEVERSLOP_VISION_MODEL`). |
| `config.json: imageResolution must be …`                   | A wrong value in `config.json` - see [Resolution](#resolution).                                                                        |
| `config.json: videoWorkflow: no workflow comfy/workflows/…` | The workflow name has a typo, or the file is missing.                                                                                  |
| `clip slot-003 skipped - missing pictures: …`              | Render the pictures first (`--render=images`) or put your own under the listed names.                                                  |
| `ComfyUI job failed - …`                                  | ComfyUI rejected or aborted the job - usually a model or node that isn't installed. Run `bun run comfy:types` and `bun run typecheck`; the ComfyUI console shows the details. |
| `typecheck` shows errors in `comfy/nodes.ts`              | A custom node with a definition the generator can't handle - see "`comfy/gen-types.ts` fixes two things" above; a new kind of problem needs a fix in `comfy/node-list.ts`. |
| `the job disappeared from <server> (restarted?)`          | ComfyUI was restarted while the job was queued or running. Run again - it is rendered again.                                            |
| `the job queued at … is no longer on <server> - rendering again` | Same, noticed at the start of a run: the old job is gone, a new one is queued.                                                 |
| `Can't assemble - N clip(s) not rendered yet`              | Render the missing clips first: `--render=videos` or `--render=all`.                                                                   |
| `videos/slot-XXX.mp4 has N frames, but the clip needs M`   | The clip was rendered too short (e.g. with an old workflow or changed timeline) - delete it and render it again.                       |
| Lips are off in the final video                             | Check that the clip's `.json` has the same `frameStart` / `frames` as `output/clips/<id>.json` - if the timeline changed after the render, delete and re-render the clip. |
| `the output node saved no .png file` (or `.mp4`)           | The workflow's `output` node isn't the node that saves the file, or it saves a different file type - see [custom-workflows.md](custom-workflows.md#the-output-node). |
