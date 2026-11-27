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
