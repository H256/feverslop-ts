# wan2gp as a render engine (experimental)

wan2gp can render beside ComfyUI (#1191): it downloads missing models by itself and manages VRAM and RAM well, also on Radeon cards
and small GPUs. FeverSlop still plans, writes the prompts and checks the takes; wan2gp only renders.

The connection is a small wan2gp plugin in its own repository,
`wangp-feverslop` (on the same git server as this repository): a REST API at `/feverslop` on the wan2gp address. Its jobs join the wan2gp queue, so they share its loaded models and show in its web UI.

```powershell
bun run wan2gp install <wan2gp folder>                 # clones the plugin into plugins/, or pulls it; restart wan2gp afterwards
bun run wan2gp health http://127.0.0.1:7860            # does the bridge answer?
bun run wan2gp render http://127.0.0.1:7860 --settings=job.json --out=renders
```

`job.json` is wan2gp settings: a `model_type`, or a Deepy template such as
`"template": "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"`, plus `prompt`, `image_refs`, `audio_guide`,
`resolution`, `video_length` and so on. Input files on this machine are uploaded first; the outputs are downloaded into `--out`.

## wan2gp servers in a project's runs (#1204)

A render server says its engine in the settings file (`bun run setup comfy` asks for it); a plain URL stays ComfyUI:

```json
{"comfy": ["http://127.0.0.1:8188", {"url": "http://radeon-box:7860", "name": "radeon", "engine": "wan2gp"}]}
```

A project sends its music-video clips to wan2gp servers too when its `config.json` names the template:

```json
{"videoWorkflowWan2gp": "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"}
```

Then a clip goes to whichever server is free first, ComfyUI or wan2gp. On wan2gp it gets the same prompt and pictures; its stems are
cut to the clip's span here and go in as audio references `<Audio 1>` to `<Audio 3>`. What stays on ComfyUI, with the reason in the
log ("ComfyUI only"):

- a clip with more than three audio references (most band clips) or more than nine pictures,
- a clip that starts on context frames of the clip before (`contextFrames`),
- pictures, reference sheets, songs, upscales and interpolation: they have no wan2gp form yet.

With only wan2gp servers, such a job fails at once and says so. Differences to the ComfyUI clip:

- the whole song is not locked into the latent as a guide (`MiniMaxH3AddGuide`): wan2gp has no counterpart;
- wan2gp may round the size to its own grid, so its takes are not checked against the size the ComfyUI workflow would render;
- a wan2gp job is not resumed by the next run (the bridge forgets its jobs when wan2gp restarts), and a take does not yet record
  which engine made it: switching `videoWorkflowWan2gp` does not make clips stale.

Compare the two before relying on it: render the same clips on both and look at them (A/B, #1204).
