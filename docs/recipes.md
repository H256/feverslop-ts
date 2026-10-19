# Recipes

Short answers to common tasks with the music-video pipeline. Each links to the part of the documentation that explains
it in full. `<id>` is the project id, the folder name in `projects/`.

- [A new project, step by step](#a-new-project-step-by-step)
- [One clip came out wrong](#one-clip-came-out-wrong)
- [Iterate cheaply](#iterate-cheaply)
- [A portrait video for social media](#a-portrait-video-for-social-media)
- [A 60 fps final video](#a-60-fps-final-video)
- [The same band in every song](#the-same-band-in-every-song)
- [Fix something in the plan by hand](#fix-something-in-the-plan-by-hand)
- [The lyrics land at the wrong time](#the-lyrics-land-at-the-wrong-time)
- [Clips show the reference pictures in a row](#clips-show-the-reference-pictures-in-a-row)
- [Render somewhere else](#render-somewhere-else)
- [What a clip request looks like](#what-a-clip-request-looks-like)
- [Troubleshooting outside ComfyUI](#troubleshooting-outside-comfyui)

## A new project, step by step

```bash
bun run init                                  # or: bun run example
bun index.ts <id> --review                    # plan; stop after story, cast, look and beats to check them
bun index.ts <id> --render=images --gallery   # the reference pictures, then look at gallery.html
bun index.ts <id> --render=videos --only=slot-001,slot-002 --dry-run   # what one try costs
bun index.ts <id> --render=videos --only=slot-001,slot-002
bun index.ts <id> --render=all                # the rest, and <id>.mp4
```

`bun run status <id>` tells you at any point what is done, what the next run redoes and which command comes next.

## One clip came out wrong

```bash
bun run inspect <id> slot-007                          # its beat, shots, pictures, audio and prompt
bun index.ts <id> --render=videos --only=slot-007 --again   # once more with a new seed
```

The old version goes to `old/attempts/slot-007-<time>/` - move its files back if you liked it better. `--again` needs
`"seed": -1` (the default). If the clip continues another one (`continuity`), name the following clips too. If the
prompt itself is the problem, edit the beat or the shots in `project.json` and run again - the requests are rebuilt;
the rendered clip is then **stale** and `--refresh=clips` renders it again. See
[Rendering with ComfyUI](../README.md#rendering-with-comfyui).

## Iterate cheaply

- `"sequenceSheets": false` in `config.json` - one flat picture per character and place instead of a turnaround video
  each. Switch it back on for the real render (the pictures are made again).
- `--only=slot-001,...` - a few clips instead of all.
- `--dry-run` - what a run would redo and render, with a time estimate from earlier renders.
- `"videoResolution": 0.5` - fewer megapixels for test clips; the default `h3-ref2video` is the fast turbo workflow,
  `h3-ref2video-full` and `h3-ref2video-2pass` cost more ([Workflows](../README.md#workflows)).
- `--review` - catch a story or a cast you don't like before anything is planned on top of it.

## A portrait video for social media

```json
{"videoAspect": "9:16"}
```

Only the clips change - characters stay portrait and places landscape. Megapixels in `videoResolution` are computed in
the given ratio. See [Resolution](comfyui.md#resolution).

## A 60 fps final video

Compare the models on one or two clips first, then switch it on:

```bash
bun run interpolate <id> --only=slot-018 --model=rife_v4.26_heavy.safetensors,film_net_fp16.safetensors
```

```json
{"finalFps": 60, "interpolationModel": "rife_v4.26_heavy.safetensors"}
```

`--render=final` then also writes `<id>-60fps.mp4`. Every clip is interpolated shot by shot, never across a cut - one
ComfyUI job per clip. The model file must be on every server that renders.

## The same band in every song

1. Render the band once in one project, then put each member into the library:
   `bun run export-asset <id> kael` (and so on).
2. In the next project, after the first run, map the roles to the library in `casting.json`:
   `"guitarist": "library:kael"`.
3. Run again - the library pictures and descriptions are copied in and never rendered again.

Best done right after a `--review` run, before the shots are planned. See [casting.json](../README.md#castingjson---who-plays-each-role)
and [The asset library](../README.md#the-asset-library). From a picture you already have: `bun run create-asset`.

## Fix something in the plan by hand

Everything generated is in `project.json`. Edit it and redo what is built on it:

| You edited | Run |
|------------|-----|
| a story beat | `--redo=mapping` |
| a character's `prop` / `propStem` | `--redo=propActivity,shotMoments` |
| `isGroup` / `alike` of a character | `--redo=characterLookVariants` |
| a character's or place's look | `--redo=characterDescriptions,locationDescriptions` |
| `music.sections` | `--redo=timeline` |
| a shot of `shotMoments` | nothing - the requests are always rebuilt |

`--redo` also redoes every step built on the named one; `--dry-run` shows the list first. Edited files in `input/` and
the planning fields of `config.json` are noticed by themselves ([Usage](../README.md#usage)).

## The lyrics land at the wrong time

Compare the line table the run prints (or `lyricsTiming.lines` in `project.json`) with the song. Fix `start`, `end`
and the word times of the wrong line, then `--redo=timeline`. A wrong `lyricsLanguage` or growled vocals make the
transcript bad - `--redo=transcript` after fixing the language. See [Singing characters](../README.md#singing-characters).

## Clips show the reference pictures in a row

Sometimes a clip renders the reference pictures lined up on their grey backdrop instead of the scene.

```bash
bun run leak-scan <id>        # finds them, prints the command that renders just those again
```

Or let the render do it: `"leakRetries": 2` in `config.json` renders such a clip again with another seed, up to twice.

## Render somewhere else

Every request is in `output/clips/slot-XXX.json`, every picture with its prompt in `output/assets.json`. Render them
with your own tool, save them as `assets/...png` and `videos/slot-XXX.mp4`, then `bun index.ts <id> --render=final`.
See [From plan to video](../README.md#from-plan-to-video). For an editor: `--export=mlt,openshot`.

## What a clip request looks like

A shortened `output/clips/slot-003.json`:

```json
{
  "id": "slot-003",
  "start": 16.556, "end": 24.242, "duration": 7.686,
  "frameStart": 397, "frames": 185,
  "section": "Intro",
  "beatId": "beat-01",
  "shots": [
    {"label": "[Shot 1]", "at": 0, "framing": "wide establishing shot", "camera": "the camera cranes up slowly",
     "subjects": ["<Subject 1>", "<Subject 2>", "<Subject 3>"]},
    {"label": "[Shot 2]", "at": 3.854, "framing": "medium wide shot", "camera": "the camera drifts sideways at a slow, even pace",
     "subjects": ["<Subject 1>", "<Subject 3>"]}
  ],
  "assets": {
    "pictures": [
      {"label": "<Picture 1>", "file": "assets/locations/the-october-field-trench-line.png", "subject": "<Subject 1>",
       "kind": "location", "id": "the-october-field-trench-line", "name": "The October field (trench line)",
       "description": "A flat October field of wet black mud stretching to a low bruise-grey horizon, …"},
      {"label": "<Picture 2>", "file": "assets/characters/thomas-callahan.png", "subject": "<Subject 2>",
       "kind": "character", "id": "thomas-callahan", "name": "Thomas Callahan", "description": "A young male in his early thirties, …"}
    ],
    "audio": [
      {"label": "<Audio 1>", "file": "output/audio/slot-003.drums.wav", "songStart": 16.556, "songEnd": 24.242, "stem": "drums"}
    ]
  },
  "prompt": "subject_definitions:\n<Subject 1> is the The October field (trench line) environment in <Picture 1>: …"
}
```

The place is always `<Subject 1>`, the characters follow; each `<Picture N>` defines the subject with the same number.
`bun run inspect <id> slot-003` shows the same clip readable, with its render state.

## Troubleshooting outside ComfyUI

ComfyUI and config errors: [comfyui.md → Troubleshooting](comfyui.md#troubleshooting).

| Problem | Cause and fix |
|---------|---------------|
| `--redo: unknown step "…"` | The error lists the step names - they are the names in the [Steps](../README.md#steps) table |
| The project is locked by another run | Only one run works on a project (`.lock` with the process id). A lock of a process that is gone is taken over by itself; otherwise wait or stop the other run. `--dry-run`, `--gallery`, `status` and `inspect` don't need the lock |
| The alignment stops: no lyric word found | Wrong `lyricsLanguage`, or vocals too distorted - listen to `stems/vocals.wav`. In clip mode `"alignLyrics": false` runs without it |
| `uv` / PyTorch / demucs / Whisper fail on the first run | `tools/vocals.py` installs them on first use (several GB). Check that `uv` is on the `PATH` and there is disk space; without CUDA it runs on the CPU, slowly ([First run](../README.md#singing-characters)) |
| The LLM answers in the wrong shape | Answers with a fixed shape are asked with a JSON schema; a server that refuses it is asked the plain way and the answer repaired. A model that still fails: try another one (`bun run setup llm-model`, or `"llm": {"model": …}` per project) |
| A step's answer is bad | `--redo=<step>` asks again; `--review` lets you edit story, cast, look and beats right after they are made |
| A failure without detail | `--debug` (or `FEVERSLOP_DEBUG=1`) shows the stack trace; the whole output of every run is in `logs/` |
