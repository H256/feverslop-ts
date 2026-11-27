# wan2gp as a render engine (experimental)

wan2gp can render beside ComfyUI (#1191): it downloads missing models by itself and manages VRAM and RAM well, also on Radeon cards
and small GPUs. FeverSlop still plans, writes the prompts and checks the takes; wan2gp only renders.

The connection is a small wan2gp plugin in its own repository,
`wangp-feverslop` (on the same git server as this repository): a REST API at `/feverslop` on the wan2gp address. Its jobs join the wan2gp queue, so they share its loaded models and show in its web UI.

## Installing the plugin

**wan2gp on another machine** (the usual case: a GPU box). `bun run wan2gp install` cannot reach it - it works on a wan2gp folder of
this machine only. Install it in wan2gp's own interface instead:

1. Open wan2gp in the browser, **Apps & PlugIn Manager**.
2. **Install from URL**: the clone URL of `wangp-feverslop`. The wan2gp machine has to be able to clone it without a password prompt and
   with a certificate it trusts; if it cannot, clone it there by hand into `<wan2gp>/plugins/wangp-feverslop`.
3. Make sure **FeverSlop Bridge** is among the enabled plugins (a plugin cloned by hand shows up as available, not enabled: enable it).
4. Restart wan2gp. Then from here: `bun run wan2gp health http://<gpu box>:7860`.

Updating: **Update** in the same manager (or `git pull` in the plugin folder), then restart wan2gp.

**wan2gp on this machine:** `bun run wan2gp install <wan2gp folder>` clones or pulls the plugin and enables it in `wgp_config.json`.
Stop wan2gp first (a running one can write its old list of plugins back), start it after.

Either way: wan2gp loads a plugin of its `plugins/` folder only when it is enabled (`enabled_plugins` in `wgp_config.json`). A plugin
that is there but not enabled stays off, and the bridge answers 404.

## Commands

```powershell
bun run wan2gp install <wan2gp folder>                 # only for a wan2gp on this machine, see above
bun run wan2gp health http://127.0.0.1:7860            # does the bridge answer?
bun run wan2gp render http://127.0.0.1:7860 --settings=job.json --out=renders
```

`job.json` is wan2gp settings: a `model_type`, or a Deepy template such as
`"template": "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"`, plus `prompt`, `image_refs`, `audio_guide`,
`resolution`, `video_length` and so on. Input files on this machine are uploaded first; the outputs are downloaded into `--out`.

## wan2gp servers in a project's runs (#1204)

A render server says its engine in the settings file (`bun run setup render` asks for it); a plain URL stays ComfyUI:

```json
{"comfy": ["http://127.0.0.1:8188", {"url": "http://radeon-box:7860", "name": "radeon", "engine": "wan2gp"}]}
```

A project renders on one engine (#1213): clips of ComfyUI and wan2gp look too different to mix in one video. Its `config.json` says which:

```json
{"renderEngine": "wan2gp", "videoWorkflowWan2gp": "gen_video_with_refs/MiniMax H3 Ref2VA Pruned PDD 8 Steps"}
```

`renderEngine` is `comfy` by default; `videoWorkflowWan2gp` defaults to the template above. `bun run init` sets `wan2gp` by itself when
only wan2gp servers are set up, asks when both kinds are, and takes `--engine=comfy|wan2gp` with its options. Only the servers of the
project's engine get its jobs; changing the engine makes every rendered clip stale. On wan2gp a clip gets its own form (#1214):

- **a short prompt**, written in the plan (step `wan2gpPrompts`, "12b · SHORT PROMPTS FOR WAN2GP") by the LLM from the clip's prompt,
  without thinking: at most 2500 characters, one continuous shot, no lyrics and no `<Audio N>`; whoever sings "sings with natural lip
  movements synchronized". Code counts the answer (length, every `<Picture N>`, no `<d>`, one shot) and asks once more with what was
  wrong; a clip whose answers do not pass renders from its full prompt and the next run asks again. Each answer is kept by the
  fingerprint of the clip's prompt and pictures. Why: wan2gp's 8-step H3 renders our full ComfyUI prompt (7000-8000 characters) badly -
  the empty place, reference poses pasted in, people missing; a short prompt in the Showrunner's form came out right (#1204);
- **the people before the place**: the pictures go in people first, a start frame next, the place last, and the short prompt numbers
  them so - a place as `<Picture 1>` made wan2gp open on the empty room;
- **the clip's sound as the soundtrack** (`audio_prompt_type: "AS"`): its stems mixed over the clip's span into one track the video
  follows and wan2gp keeps as its audio.

What has no wan2gp form yet, and fails in a wan2gp project with the reason in the log:

- a clip with more than nine pictures,
- a clip that starts on context frames of the clip before (`contextFrames`),
- songs, previews, upscales and interpolation (#1211) - make them in a ComfyUI project, or bring them in by hand.

Pictures (characters, places, props) render on wan2gp too (#1211): the `gen_image` template `imageWorkflowWan2gp` (default
`gen_image/Krea 2 Turbo (8 Steps)`) with the same prompt and seed, 1920x1088 (standing for a character), wan2gp's prompt enhancer off.
Reference sheets (`sequenceSheets`) render on wan2gp as on ComfyUI: the anchor on the picture template, the silent turnaround video on
the `gen_video` template `sequenceWorkflowWan2gp` (default `gen_video/MiniMax H3 FL2VA Pruned PDD 8 Steps` - the distilled model needs no
LoRA; the Lightx2v template needs its LoRA in wan2gp's `loras/`, a bridge job does not download it) with the anchor as first frame. wan2gp saves pictures as .jpg; they are converted to .png on download.
The picture's record names the engine; it is not part of its fingerprint, so switching engines does not make pictures stale.

Differences to the ComfyUI clip:

- the whole song is not locked into the latent as a guide (`MiniMaxH3AddGuide`): wan2gp has no counterpart;
- wan2gp may round the size to its own grid, so its takes are not checked against the size the ComfyUI workflow would render;
- a wan2gp job is not resumed by the next run (the bridge forgets its jobs when wan2gp restarts);
- the composition varies more from seed to seed: a clip may open on the empty place or leave a person out - render it again.

Compare the two before relying on it: render the same clips on both and look at them (A/B, #1204).
