# Render engines: ComfyUI and wan2gp side by side (design)

Design for #1193, part of #1191. Status: **proposed, not built**. The wan2gp side talks to the bridge plugin of #1192
(`wan2gp/plugin`, `lib/wan2gp.ts`).

## Goal

Each render server says which engine it runs. A project spreads its jobs over every free server that can run them: the local RTX on
ComfyUI, the Radeon cards and small machines on wan2gp, three servers at once. Planning, prompts, timing, checks and the take records
stay the same whichever engine rendered a take.

## Where the seam is today

The pipeline already describes a render job without ComfyUI in it. Each job kind has an options type in `comfy/helpers.ts`
(`VideoWorkflowOptions`, `ImageWorkflowOptions`, `AudioWorkflowOptions`, the sequence and interpolation options). A workflow module turns
those options into a ComfyUI graph (`WorkflowResult`). `Renderer` (`lib/render.ts`) then uploads inputs, queues the graph on a server
from its pool, waits, and downloads the output.

So the seam is **between the options and the graph**. A wan2gp job is the same options turned into wan2gp settings JSON instead.

## Interface

```ts
// lib/engines.ts (new)
type Engine = 'comfy' | 'wan2gp'

/** One job kind on one engine: the options in, what to send, and how to read the output back. */
type EngineJob<Options> = {
    engine: Engine
    /** the name recorded with the take (provenance, render spec): "h3-ref2video" or "wan2gp:gen_video_with_refs/MiniMax H3 ..." */
    workflow: string
    build(options: Options): ComfyJob | Wan2gpJob
}
type ComfyJob = {kind: 'comfy'; result: WorkflowResult} // as today
type Wan2gpJob = {kind: 'wan2gp'; settings: BridgeSettings; inputs: string[]} // local files to upload first
// postprocess (upscale, frame interpolation) is a job of its own on wan2gp
type Wan2gpPostprocess = {kind: 'wan2gp-post'; media: string; spatial?: string; temporal?: string}
```

`Renderer` keeps its pool, its queueing per server, its retries and its records. Only the "send this job to this server and wait"
step gets a second implementation: the existing ComfyUI one, and one that uses the bridge client (upload, `generate`/`postprocess`,
`waitForJob`, download). Each server in the pool carries its engine. A job goes only to servers whose engine has a builder for its
job kind; with none, it fails at once and names the job kind and the engines that can do it.

Input naming differs: ComfyUI gets input names inside its `input/` folder, the bridge gets content-hash names from `/api/files`. The
builders take the local paths; the engine step uploads them and puts the returned names in.

## Config

The machine settings (`bun run setup`, the settings file) get an engine per server. A plain URL stays ComfyUI, so every existing
settings file keeps working:

```json
{
    "comfy": [
        "http://127.0.0.1:8188",
        {"url": "http://comfyui2.elysium.lan:7860", "name": "radeon", "engine": "wan2gp"}
    ]
}
```

The key stays `comfy` for now. Renaming it to `render` is a later clean-up with a migration, not part of this.

The project config gets, per job kind, the wan2gp template to use besides the ComfyUI workflow, for example
`"videoWorkflowWan2gp": "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"`. Like `videoWorkflow`, it is a literal name, not
something resolved (see the ComfyUI model path convention). A project without it does not send that job kind to wan2gp servers.

## Mapping table

| Job (today's workflow) | wan2gp | Gap |
| --- | --- | --- |
| H3 clip (`h3-ref2video*`, music) | `gen_video_with_refs` H3 Ref2VA template; `image_refs` = pictures in `<Picture N>` order; the song or vocals slice as `audio_guide` with `audio_prompt_type: "AS"`; `video_length` from `frames` | **Multi-track audio:** our workflow gives every audible stem as its own `<Audio N>` plus the whole song as a guide. wan2gp's H3 path takes one driving audio (`audio_guide`, `audio_guide2` for a second voice). The band prompts that name `<Audio N>` need a one-audio form, or band clips stay on ComfyUI. |
| H3 clip with a pinned start frame (`startFrame`) | `image_start` + `image_prompt_type: "S"` | none known |
| H3 clip going on from the clip before (`startClip`, context frames) | `video_source` = the last frames + `sliding_window_overlap` = their count; the output's first frames are the shared ones and are cut off | Our `CONTEXT_SETTLE` handling has to be checked against wan2gp's overlap |
| H3 film clip (`h3-ref2video-film*`) | as the music clip, with the line as `audio_guide` | Films with several speakers in one clip: same multi-audio gap |
| Two-pass / refine (`*-2pass`, `h3-refine`, `h3-latent-upscale`) | the "H3 Regenerate 2K IC" two-phase preset (draft at half size, then 3 steps at full size with the draft as reference video) | not the same recipe: needs its own A/B test before it counts as an equivalent |
| Reference pictures (`krea2-image`, `kroma-image`, `h3-image`) | `gen_image` templates (Krea 2 Turbo, H3-Image Pruned, Flux Klein, Qwen Image ...) | a wan2gp picture is not the same as the ComfyUI one: a project keeps its pictures on one engine, or their fingerprints differ |
| Sequence sheet (`h3-sequence-to-sheet*`) | an H3 FL2VA video from the anchor, the sheet cut from its frames as today | to be built, keep on ComfyUI first |
| Song (`yue2-song`) | `gen_song` YuE2 template (`prompt` = lyrics, `alt_prompt` = style) | none known |
| Upscale (`video-upscale`) | postprocess `spatial` (the upsamplers enabled in wan2gp) | other models than ours |
| Frame interpolation (`frame-interpolate`) | postprocess `temporal` (RIFE) | our per-shot pieces (`pieces`) are interpolated one by one so cuts do not blur: the bridge would need one job per piece, or a cut list |

## Records and staleness

The render spec and provenance already record the workflow name. With `workflow` = `"wan2gp:<template>"`, a take from wan2gp is a
different spec than one from ComfyUI. So:

- switching a clip's engine makes it stale, as switching a workflow does today, and
- a project can hold takes from both engines, each recorded with what made it.

A job a wan2gp server reports as failed leaves no record, like on ComfyUI (#1189).

## Distribution

The current pool dispatches to the first free server that answers. With engines it filters by "can run this job kind" first, then
picks as today. A server that fails a job is marked down and the job goes back to the queue: an out-of-memory job on the Radeon can
then land on another server. Whether to retry it on another engine is a project setting (a take on another engine looks different),
off by default.

## Steps to build (steps 1-3: #1204)

1. Engine field in the settings and the pool; `bun run setup` asks for it. Bridge `health` in the server check.
2. The engine step in `Renderer` for wan2gp, with the H3 clip builder (single driving audio), CLI first:
   `bun index.ts <id> --render=videos --only=<clip>` on a wan2gp server.
3. A/B: the same clips from ComfyUI and wan2gp (prompt, pictures, audio, seed), judged by eye and by the clip checks.
4. Pictures, song, upscale and interpolation builders, each after its own check.
5. Multi-audio H3 prompts in a one-audio form, if band clips should go to wan2gp too.

The CLI runs and the workspace only starts them, as everywhere else.
