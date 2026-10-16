# FeverSlop TS

Turns a song (lyrics + audio) into a beat-matched music video plan: a story, characters, locations, a film look,
Krea 2 image prompts for the reference pictures, and one MiniMax H3 reference-to-video request per clip, covering the
whole song.

Two modes:

- **Clip mode** (default) - the story is acted out, the song is the soundtrack.
- **Performance mode** - one or more characters *sing* the lyrics on screen while acting out the story, lip-synced to
  the real vocals. See [Singing characters](#singing-characters).

## Requirements

- [Bun](https://bun.com)
- [uv](https://docs.astral.sh/uv/) – runs the song analysis (`tools/analyze_song.py`, installs librosa on first use)
  and, for singing characters, the stem separation and transcription (`tools/vocals.py`, installs PyTorch with CUDA
  13.0, demucs and Whisper on first use - runs on the CPU without an NVIDIA GPU, just much slower)
- [ffmpeg](https://ffmpeg.org) – cuts the song into one audio file per clip
- An OpenAI-compatible LLM server with the Responses API (llama.cpp, vLLM, LM Studio, …) – see [Setup](#setup)
- Optional, for rendering: one or more [ComfyUI](https://github.com/comfyanonymous/ComfyUI) servers with the models
  and nodes of the workflows – see [docs/comfyui.md](docs/comfyui.md#setup)

```bash
bun install
bun run setup
```

| Script                  | What it does                                                                 |
|-------------------------|------------------------------------------------------------------------------|
| `bun run setup`         | connects the LLM server and the ComfyUI servers - see [Setup](#setup)        |
| `bun run init`          | creates a new project - see [Creating a project](#creating-a-project)        |
| `bun run example`       | creates a random example project and generates its song - see [Creating a project](#creating-a-project) |
| `bun run inspect <id> <clip>` | one clip on one screen: its beat and staged shots, pictures and audio, render state and prompt |
| `bun run typecheck`     | type-checks the project, including the workflows against the ComfyUI nodes   |
| `bun run comfy:types`   | regenerates the ComfyUI node types after installing nodes or models          |
| `bun run comfy:convert` | turns a ComfyUI workflow (API export) into a draft workflow file             |

## Setup

The servers are machine settings, not project settings - they live in a settings file outside the repo:

- Windows: `%APPDATA%\feverslop-ts\settings.json`
- elsewhere: `$XDG_CONFIG_HOME/feverslop-ts/settings.json`, or `~/.config/feverslop-ts/settings.json`
- `FEVERSLOP_SETTINGS=<path>` uses another file

`bun run setup` writes it - it asks for everything, tests every server before saving and lets you pick the model with
the arrow keys. Each part also works on its own:

| Command                   | What it does                                                                               |
|---------------------------|--------------------------------------------------------------------------------------------|
| `bun run setup`           | everything below, in order                                                                 |
| `bun run setup llm`       | the LLM server: URL → API key (optional) → connects, lists the models → pick one            |
| `bun run setup llm-model` | only the model: lists the models of the configured server → pick one                       |
| `bun run setup comfy`     | the ComfyUI servers with their status (GPU, free VRAM) - add, remove, test again           |
| `bun run setup show`      | the effective settings and where each value comes from, API keys masked                    |

The file, if you'd rather write it yourself:

```json
{
  "llm": {"url": "http://localhost:8080/v1", "apiKey": "…", "model": "Muse-Glimmer-30B-GGUF"},
  "comfy": ["http://localhost:8188", {"url": "https://gpu2.lan:8188", "name": "gpu2", "token": "…"}]
}
```

- `llm.parallel` (default 1): how many LLM calls may run at once - set it to the number of slots of the server
  (`llama-server --parallel N`, vLLM). Only calls that don't depend on each other run at once (the descriptions, the
  looks of the places, the views of the shots); everything else stays in order.
- `llm.apiKey` is optional - local servers usually need none. Without `llm.model`, the server's only model is used;
  a server with several models needs one picked.
- `comfy` entries are a URL, or `{"url", "name", "token"}` / `{"url", "name", "username", "password"}` for a server
  behind a proxy with authentication. `name` (default: the host) shows up in the log. Without `comfy`,
  `http://localhost:8188` is used. With several servers, pictures and clips are rendered on all of them in parallel -
  see [docs/comfyui.md](docs/comfyui.md#several-servers).

Everything can be overridden, lowest first: the settings file → the project's `config.json` (only `"llm": {"model":
…}` - a project may use another model, never another server or key) → env vars → flags (this run only, never saved):

| Env var                                 | Flag              | Value                                             |
|-----------------------------------------|-------------------|---------------------------------------------------|
| `FEVERSLOP_LLM_URL`                    | `--llm-url=`      | the LLM server, with `/v1`                        |
| `FEVERSLOP_LLM_API_KEY`                | `--llm-key=`      | its API key                                       |
| `FEVERSLOP_LLM_MODEL`                  | `--llm-model=`    | a model id of the server                          |
| `FEVERSLOP_LLM_PARALLEL`               | `--llm-parallel=` | LLM calls at once, 1 or more                      |
| `FEVERSLOP_COMFY` (or the old `COMFY`) | `--comfy=`        | ComfyUI servers, comma-separated: `http://a:8188,http://b:8188` |

Prefer the settings file or the env var over `--llm-key` - flags end up in the shell history. Without a terminal
(CI, scripts), `bun run setup` prints these env vars instead of asking.

Answers with a fixed shape (the cast, the beats, the views, the singers, the style shortlist) are asked with a JSON
schema on the server's Chat Completions API (`response_format`), so the server keeps the answer to that shape and to the
ids of the cast; the Responses API of llama.cpp ignores a schema. A server that refuses it is asked the plain way, and
the answer is read and repaired as before.

The LLM server is only contacted when a step actually needs it, and ComfyUI only when something is rendered - a fully
cached project runs without either.

## Documentation

- [docs/project-tutorial.md](docs/project-tutorial.md) – step-by-step walkthrough of `bun run init`/`bun run example`
  and running the pipeline on the result
- [docs/comfyui.md](docs/comfyui.md) – rendering with ComfyUI: setup, `config.json`, re-rendering, things to know,
  troubleshooting
- [docs/custom-workflows.md](docs/custom-workflows.md) – adding your own ComfyUI workflows as code
- [docs/film.md](docs/film.md) – the experimental short-film pipeline (`bun run film:init`, `bun film.ts`): idea or screenplay → film

## Creating a project

```bash
bun run init
```

An interactive wizard, in the same style as `bun run setup`: it asks whether you already have the song (an audio
file to copy in) or want one generated from a song idea, whether you have lyrics and/or a story idea, an optional
visual style, and whether to use the project defaults or customize settings like singers or resolution. It then
writes `projects/<id>/` and prints the `bun index.ts` command to run.

```bash
bun run example
```

Picks one of 10 built-in song ideas at random (with a matching visual style), creates a project with a short
generated id and a 1-minute `songDuration`, and immediately generates its song (`--render=song`). Use
`bun run example --no-render` to only create the project files without generating the song yet.

Both write into `projects/<id>/` using the same file layout described below - you can just as well create it by hand.

## Usage

Every song is a project folder:

```
projects/<project-id>/
  input/
    song.wav          required (or song.mp3), unless generated with --render=song (see Generating the song)
    lyrics.txt        lyrics with section tags: [Intro], [Verse 1], [Chorus], ... - required, unless generated
    idea.txt          the song idea for --render=song - required for it, otherwise unused
    music-style.txt   optional - musical direction for --render=song, e.g. genre/instruments/mood
    story-idea.txt    optional
    style.txt         optional - the film's style, e.g. "dark gothic oil painting, heavy chiaroscuro"
  config.json         settings: singers, lyrics language, rendering (see config.json)
  stems/              the song's stems (vocals, drums, bass, other) - only when lyrics are aligned
  assets/             reference pictures, rendered or your own - never overwritten;
                      clips/<clip-id>_ff.png, _lf.png: first and last frame of every rendered clip
  videos/             rendered clips - never overwritten
  <project-id>.mp4    the assembled music video - rebuilt by --render=final (projects from before this: final.mp4, left alone)
  timeline.mlt / .osp the cut as an editable timeline for Shotcut/Kdenlive / OpenShot - written by --export
  gallery.html        overview page of the generated assets (tabs: cast, storyboard, videos) - written by --gallery
  project.json        all generated data, step by step
  output/             generated H3 requests - rewritten on every run; the run before is kept in output/.previous/,
                      and the run lists the requests it changed
```

Run it:

```bash
bun index.ts <project-id>             # the project in projects/<project-id>/ (create one with: bun run init)
bun index.ts                          # without an id: pick one of the projects with the arrow keys (most recently changed
                                       # first) - without a terminal, an error listing them
bun index.ts --render=song            # write song.wav + lyrics.txt from idea.txt first, see below
bun index.ts --redo=beats             # regenerate a step and everything built on it
bun index.ts --redo=story,lookBrief   # several at once
bun index.ts --review                 # stop after the story, the cast, the look and the beats when they were just generated:
                                       # accept, edit them in $EDITOR (text, or JSON for cast and beats), generate again, or stop
bun index.ts --render=all             # also render with ComfyUI and assemble <project-id>.mp4, see below
bun index.ts --export=mlt,openshot    # write timeline.mlt (Shotcut/Kdenlive) and/or timeline.osp (OpenShot): clips on one track, the song under them (or --export=all)
bun index.ts --gallery                # write projects/<id>/gallery.html: cast, storyboard and videos at a glance
bun index.ts --debug                  # a failure shows its stack trace below the error box (or FEVERSLOP_DEBUG=1)
bun index.ts --debug-audio            # also cut one listenable wav per track and clip into output/audio (not needed for rendering)
bun index.ts --legacy-moments         # skip step 11b, spread beat.moments across shots the old way
bun index.ts --redo=propActivity,shotMoments   # re-check instrument activity after editing prop/propStem by hand
```

Finished steps are cached in `project.json` and skipped on the next run - a run that breaks halfway continues where it
stopped. You can edit `project.json` by hand (a story beat, a look prompt, a section time) and run again; the H3
requests are always rebuilt from the current data.

Edited inputs are noticed: `project.json` keeps a fingerprint of every input, and a changed one redoes the steps
built on it (and everything built on those):

| Changed                       | Redoes                              |
|-------------------------------|-------------------------------------|
| `idea.txt`                    | `songBrief`                         |
| `music-style.txt`             | `songBrief`                         |
| `song.wav`/`song.mp3`         | `music`, `stems`                    |
| `lyrics.txt`                  | `story`, `transcript`, `singing`    |
| `story-idea.txt`              | `story`                             |
| `style.txt`                   | `lookBrief`                         |
| `singers` in `config.json`    | `singing` (and so `beats`)          |
| `lyricsLanguage`              | `transcript`                        |
| `continuity` in `config.json` | `shotMoments`                       |

### Generating the song

Without `input/song.wav` (and `input/lyrics.txt`), `--render=song` writes both from `input/idea.txt` before the rest
of the pipeline runs:

1. **Song brief** (step `1`, `songBrief`) - an LLM turns `idea.txt` (+ optional `music-style.txt`, the target length
   from `songDuration` in `config.json`, and `lyricsLanguage`) into a YuE2 `style` prompt (comma-separated genre,
   instruments, mood, vocal gender, vocal tone) and `lyrics` with section tags. Both are written back to
   `lyrics.txt` and `music-style.txt` - each only if it doesn't already exist yet, so a hand-written file is never
   overwritten, and the generated style stays around to read, tweak or reuse (e.g. `--redo=songBrief` after editing
   it, to keep your own style but get new lyrics for it).
2. **Song audio** (step `1a`) - renders the song with the YuE2 ComfyUI workflow (`songWorkflow` in `config.json`,
   default `yue2-song`) and writes `input/song.wav`. `songDuration` (default: the workflow's own, 360s) is only an
   upper bound - the model decides the actual song length.

`--render=song` is a no-op once `input/song.wav` exists - delete it (and `lyrics.txt`, if it should be rewritten too)
and run `--render=song` again to generate a new song. `--redo=songBrief` alone rewrites just the brief (style and
lyrics) without touching an existing `song.wav`. Without `idea.txt`, the pipeline behaves exactly as before:
`song.wav` and `lyrics.txt` must be supplied by hand.

### Style

Without `input/style.txt` the first run has the LLM shortlist 5 fitting styles from [lib/styles.ts](lib/styles.ts) and
draws one of them at random - so the look fits the story without following the LLM's favorites. It is written to
`input/style.txt` once; edit or replace the file afterwards (the look brief is then redone). `bun run init` can also
set the style up front: typed, from a file, or chosen from the list. With the file, the look
brief keeps your medium, style and named references exactly and only extends them - world, palette, lighting, camera
language, texture - so every picture and clip prompt stays in your style. A sentence or two is enough:

```
Dark gothic oil painting in the manner of Caravaggio, heavy chiaroscuro, candlelight only.
```

[docs/style-examples.md](docs/style-examples.md) lists all the built-in styles (classic to modern live action, anime,
2D/3D animation, stop-motion, painted and found-media looks) to copy into `style.txt`.

The longest clip the video model can generate is set in `index.ts` as `MAX_CLIP_SEC` (10 seconds - the H3 node
actually renders such a slot as 10.13 s, see [The final video](#the-final-video)).

## Steps

| # | Step (`--redo=`) | What it does                                                                     | Built on                     |
|---|------------------|----------------------------------------------------------------------------------|------------------------------|
| 1  | `songBrief`      | YuE2 `style` prompt and `lyrics` from `idea.txt` (+ optional `music-style.txt`) ⁵ | –                            |
| 1a | –                | Song audio rendered with the YuE2 workflow → `input/song.wav` ⁵                   | songBrief                    |
| 2  | `music`          | BPM, downbeats, energy per bar, song sections named after the lyrics tags         | –                            |
| 2a | `stems`          | demucs `htdemucs_ft` → `stems/{vocals,drums,bass,other}.wav` ¹                    | –                            |
| 2b | `transcript`     | Whisper large-v3 on `vocals.wav`, word timestamps, the lyrics as prompt ¹         | stems                        |
| 2c | `lyricsTiming`   | The known lyrics aligned to the transcript: start and end of every line and word ¹ | transcript                   |
| 3  | `story`          | Story from lyrics and/or story idea                                              | –                            |
| 4  | `summary`        | Short summary                                                                    | story                        |
| 5  | `cast`           | Characters and locations with ids, each character's `prop` and, if it's a heard instrument, its `propStem` ⁴ | story |
| 5a | `instrumentStems` | Guitar/piano separated from `other` with a second, narrower demucs pass, only for `propStem`s that need it ⁴ | stems, cast |
| 5b | `singing`        | The singers, and who sings which line ²                                          | cast                         |
| 5c | `propActivity`   | RMS-energy activity ranges per instrument stem claimed by a character ¹ ⁴        | stems, cast                  |
| 6  | `lookBrief`      | Film look for MiniMax H3: one format and style, palette, camera language - extends `style.txt` if there is one | summary |
| 7  | `characterLooks` | Krea 2 prompt per character (reference sheet, plain background)                  | cast, lookBrief              |
| 7b | `characterDescriptions` | The character look without the reference sheet - no pose, background, light or medium - for the clip prompts | characterLooks |
| 8  | `locationLooks`  | Krea 2 prompt per location (empty establishing shot)                             | cast, lookBrief, summary     |
| 8b | `locationDescriptions` | The location look without the establishing shot - no camera, "empty" or medium - for the clip prompts | locationLooks |
| 8c | `locationAnchors` | Two or three fixed features of each place, as one phrase - kept behind the people of every shot, so no shot falls back to the grey backdrop of the character pictures | locationDescriptions |
| 9  | `beats`          | Story beats without timing: moments, location, characters, intensity, continuity | story, cast, singing         |
| 10 | `timeline`       | Song cut into clips on downbeats, as many bars as fit into `MAX_CLIP_SEC`; with the lyrics timing, real section starts and the words sung in every clip | music, lyricsTiming |
| 11 | `mapping`        | Beats stretched over the clips in story order, matching intensity to energy      | beats, timeline              |
| 11b | `shotMoments`   | The staged shots per beat: floor plan, then per shot the action, who is in the picture and where they stand and move, replacing `beat.moments` ³ | beats, timeline, mapping, propActivity |
| 12 | –                | MiniMax H3 requests, built deterministically, never cached                       | everything                   |

¹ only when the lyrics are aligned (`alignLyrics`, on when someone sings) · ² only when someone sings ·
³ skipped with `--legacy-moments`, which spreads/reuses `beat.moments` across shots instead (the old behavior) ·
⁴ only when at least one character's `prop` is a musical instrument actually heard in the song - see
[Band members and instruments](#band-members-and-instruments) ·
⁵ only with `--render=song`, and only while `input/song.wav` doesn't exist yet - see
[Generating the song](#generating-the-song)

Steps 1, 3–9 (with 8c) and 11b use the LLM (5b only for `"auto"` or several singers), all others are plain code.

The looks (7, 8) are image prompts for the reference pictures - they put a character on a plain grey background in
studio light, a location in an empty wide shot. That must not end up in the videos, so the clip prompts define every
`<Picture N>` with its description (7b, 8b) instead: only what the character or place looks like. One LLM call per
character and location, from its look, so it matches the picture. Redoing a look redoes its description; to rewrite
only the descriptions: `--redo=characterDescriptions,locationDescriptions`.

## Output

`projects/<project-id>/output/`:

- `timeline.json` – BPM, all story beats and every clip with start, end, section, beat and its request file
- `clips/slot-001.json …` – one H3 reference-to-video request per clip: the prompt, the shots with their cut times, the
  clip's place on the song's frame grid (`frameStart`, `frames`), and the assets in label order (`<Picture 1>`,
  `<Picture 2>`, …, `<Audio 1>`, `<Audio 2>`). Every picture lists the character or location it shows (`kind`, `id`,
  `name`) and the `description` the prompt uses for it. Clips with a singer also list their `vocals`: every sung part with
  its clip-relative time, text, singer, subject and speaker id
- `audio/slot-001.song.wav …`, `audio/slot-001.vocals.wav …` – debug-listenable slices of each referenced stem, cut
  to the clip's span on the frame grid. They aren't what's actually rendered with: `lib/render.ts` uploads and trims
  the whole stem itself, using `<Audio 1>`, `<Audio 2>`, … for whichever stems the clip's assets reference
- `assets.json` – the pictures the requests expect, each with the Krea 2 prompt to generate it (`prompt`) and the
  description the clip prompts use for it (`description`)

The prompts follow the
[MiniMax H3 full-reference prompt guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md):
`subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`,
`non_diegetic_music`. The location is `<Subject 1>`, the characters of the beat are `<Subject 2>` and up, each defined
by the `<Picture N>` with the same number.

## Rendering with ComfyUI

The reference pictures and the clips can be rendered directly on one or more ComfyUI servers (see [Setup](#setup)) and
are saved into the project:

```bash
bun index.ts --render=all                       # missing pictures, missing clips, then <project-id>.mp4
bun index.ts --render=images                    # Krea 2 reference pictures -> assets/
bun index.ts --render=videos                    # MiniMax H3 clips -> videos/
bun index.ts --render=final                     # assemble <project-id>.mp4 from the rendered clips
bun index.ts --render=videos --only=slot-001    # just some clips, to try things out
bun index.ts --render=videos --only=slot-005 --again   # slot-005 once more, with a new seed - the old one is kept
```

- Existing pictures and clips are never overwritten - delete one to render it again. Your own pictures in `assets/`
  are used as they are.
- `--again` renders the clips named in `--only` (required - it never redoes everything) once more. The old version -
  the video, its `.json` and its first and last frame - is put away in `old/attempts/<clip-id>-<time>/`, so you can make
  several versions of a clip and keep the one you like: move its files back to where they were. It needs a new seed
  (`"seed": -1` in `config.json`, the default - a fixed seed gives the same clip again). A clip that goes on from the last
  frame of one you render again is named, but not rendered with it - name it too if the picture should go on from the new one.
- Every rendered file gets a `.json` next to it with the workflow, seed, resolution and a `fingerprint` of what it was made
  from (prompt, workflow, the content of its pictures and - for a clip that goes on from another - that clip). An existing
  file whose fingerprint no longer matches the plan is **stale**: it is used as it is and listed (when rendering, and
  when the final video is assembled). `--refresh=pictures,clips` puts the stale ones away in `old/attempts/` and renders
  them again; `--strict` makes the final video refuse stale clips. Files without a fingerprint (older projects) and
  pictures you replaced with `replace-character` (their `.json` says `"source": "user"`) are never reported.
- A job that was queued for another request than the plan has now is not resumed after an interruption (its
  `.pending-<id>.json` is kept), the clip is queued again.
- Only one run works on a project at a time (`.lock` in the project folder, with the process id; a lock of a process
  that is gone is taken over).
- Clips are skipped until all their pictures exist; the final video needs all clips.
- With several ComfyUI servers, all pictures - then all clips - are rendered in parallel, one job per server. The
  status line at the bottom shows every running job and its server.

### The final video

`--render=final` cuts every clip to exactly its frames, joins them and lays the original song under the whole video
(or the clips' own audio, with `"songAudio": false`). The timing is frame-exact, which matters for lip-sync:

- All clips sit on one 24 fps frame grid for the whole song. Clip boundaries are rounded to it once, so the clips add
  up to exactly the song's frame count - no drift, however many clips there are.
- The H3 node only renders 5 + 17·k frames, so each clip is rendered a little longer than it needs (a 10 s slot as
  10.13 s). The audio given to the model starts exactly on the clip's first frame and covers the whole render.
- In the final video every clip is cut back to its own frames from frame 0 on. Every frame is then at exactly the
  moment of the song it was generated for, and the song fits underneath unchanged.

How it works in detail: [docs/comfyui.md](docs/comfyui.md#the-final-video-and-frame-exact-timing).

### Continuous scenes

Every clip is rendered on its own, from the location sheet and the character pictures - so two clips of the same room
can disagree about where the door is, and every clip boundary is a cut. A beat can be **continuous**: its clips then run
on without a cut. The beats step (`beats`) may mark a beat `"continuous": true` (one unbroken take: a long walk, a slow
reveal); `"continuity": "auto"` in `config.json` lets the clips of those beats run on, `"always"` does it for every beat.
**It is off by default** (`"never"`: every clip is its own cut) - read the side effect below before switching it on.

> **Side effect: the picture drifts, and the next clip starts on the drift.** A continuing clip starts on the last frame
> of the clip before it, so whatever that clip did to the picture is the starting point of the next one. In a still,
> locked-off shot (a person at a mirror, almost no movement) the model has little to follow and tends to re-draw the
> picture: a faint double of the head and of the reflection, wall patches that slide, a black patch at an edge, an
> object that was not there. Such a clip is clean in its first frame and worse every second - and the clip after it
> starts on that last frame and keeps it. Continuity therefore suits shots with real movement (a walk, a reveal, a
> fight) and not a held pose. If a continuing clip looks wrong, render it with another seed (`--again`) before the
> ones after it, or set `"continuity": "never"` again. (Seen in a bathroom-mirror project, `h3-ref2video`: a pinned
> frame that was also given as a reference picture made it much worse - the frame now goes in as the pin only.)

In a continuous beat each clip but the first gets the last frame of the clip before it (`assets/clips/<id>_lf.png`) as one
more reference picture, written into the prompt as the first frame of `[Shot 1]` (`keyframe completion`), and the shot
moments of the beat are written to follow each other without a restart. What follows from that:

- The clips of a beat render **one after the other**, the beats next to each other. A clip whose predecessor isn't
  rendered yet is skipped with a warning - run `--render=videos` again.
- Rendering a clip again leaves the clips after it starting on its old last frame; the next run warns about each (delete
  `videos/<id>.mp4` to render it again).
- A changed `continuity` redoes `shotMoments`.
- As a reference picture the frame carries the room and the people, but not the exact pose and framing of the frame:
  the clip may start from a different position. `pinStartFrame` (on by default) locks it to the frame at frame 0 (`MiniMaxH3AddGuide`
  with the image); a clip then starts on the exact frame the one before ends on. With `pinStartFrame` the frame is
  **not** also one of the reference pictures (the same image twice made the model blend it in a second time, shifted).

### config.json

Settings per project, all optional - read at every run and checked field by field:

```json
{
  "singers": [],
  "singerVoice": "auto",
  "lyricsLanguage": "en",
  "continuity": "never",
  "seed": -1,
  "imageResolution": -1,
  "videoResolution": -1,
  "imageWorkflow": "kroma-image",
  "videoWorkflow": "h3-ref2video",
  "songWorkflow": "yue2-song",
  "songDuration": -1,
  "songAudio": true,
  "llm": {}
}
```

| Field                                 | Values                                                                                                    |
|---------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `llm`                                 | `{"model": "…"}` = another model of the LLM server for this project; default `{}` = the one from the [settings](#setup) |
| `singers`                             | `[]` = clip mode (default), `["auto"]` = the LLM picks the lead singer, `["Thorin", "brenna"]` = these characters, by name or id - see [Singing characters](#singing-characters) |
| `lyricsLanguage`                      | language of the lyrics as a code, `"en"` (default), `"de"`, … - for Whisper, the `<d>[English]` lyrics tag, and the song brief (`--render=song`) |
| `alignLyrics`                         | `true` = stems, transcript and real lyric timing; default: `true` when someone sings, else `false`. Set it to `true` in clip mode to place the lyric cues at the right moments |
| `continuity`                          | `"never"` (default) = every clip is its own cut, `"auto"` = the beats the story planning marked `continuous` run on without a cut, `"always"` = every clip but the first of each beat starts on the last frame of the clip before it. Off by default: the picture drifts from clip to clip and the next one starts on the drift - see [Continuous scenes](#continuous-scenes) |
| `pinStartFrame`                       | `true` (default) = a continuing clip is locked to the last frame of the clip before it as its first frame (`MiniMaxH3AddGuide`, `h3-ref2video`); `false` = that frame is only one of the reference pictures, which carry the room and the people but not the pose - see [Continuous scenes](#continuous-scenes) |
| `locationView`                        | `"auto"` (default) = the shot planning chooses one of the five views of the place for every shot (step `shotViews`, 11c) and a clip gets the one of its first shot as its place picture; `-1` = the whole reference sheet (all five views side by side - the video model shows that back as a grid with a black patch in the first seconds), `0`-`4` = that one view for every clip (front, right, behind, left, wide). Needs the sequence sheets (`sequenceSheets`, on by default) - without them the picture is the plain one. The choice is made from the text of the plan and the names of the views, never from the pictures: a language model that cannot read images is enough, and it is deliberately kept that way |
| `fightClips`                          | `false` (default) = fight beats are cut like every beat; `true` = the clips of a fight beat (a "hit" with a crowd of creatures) are cut into one-bar pieces with one shot each and only the people of the shot as references - see `docs/comfyui.md` |
| `leakRetries`                         | `0` (default) = off; `1` or more = a clip that came out as the reference pictures lined up on their grey backdrop is rendered again with another seed, that many times at most (needs `"seed": -1`). Already rendered clips: `bun run leak-scan <project-id>` - see `docs/comfyui.md` |
| `seed`                                | `-1` = random for every render (the seed used is saved in the `.json`), `0` or more = fixed              |
| `imageResolution`, `videoResolution`  | `-1` = the workflow's own size, `1.1` = megapixels, `"1920x1088"` = fixed size                            |
| `imageWorkflow`, `videoWorkflow`, `songWorkflow` | a workflow file in `comfy/workflows/`, without `.ts`                                              |
| `songDuration`                        | `--render=song`: an upper bound in seconds for the generated song - the model decides the actual length; `-1` = the workflow's own default (360s for `yue2-song`) |
| `songAudio`                           | final video: `true` = the original song replaces the clips' audio (default), `false` = keep the clips' audio |

Characters are always portrait, locations and videos landscape - whichever way round the size is written. Videos are
always 24 fps. Details, examples and the resulting sizes: [docs/comfyui.md](docs/comfyui.md#project-config-configjson).

### Workflows

The ComfyUI workflows are TypeScript files in `comfy/workflows/`, built with the
[ComfyUI SDK](https://github.com/comfy-addons/comfyui-sdk) (`@saintno/comfyui-sdk`). Its `WorkflowBuilder` is generated
from your server (`comfy/nodes.ts`), so `bun run typecheck` catches a missing model, a wrong sampler name or a wrong
connection before anything is rendered. The same SDK runs the jobs: uploads, progress, downloads, reconnects.

| Workflow        | Kind  | Originally exported from ComfyUI as ¹              |
|-----------------|-------|-----------------------------------------------------|
| `kroma-image`   | image | `kroma.json` (default)                              |
| `krea2-image`   | image | `image_t2i_startframe_krea_v1.json`                |
| `h3-ref2video`  | video | `r2v_audio_fullmix_guide_1-pass_turbo.json`        |
| `yue2-song`     | audio | `audio_yue2_text2music.json`                       |

¹ The export JSON is only a one-time input to `bun run comfy:convert` (see below); it isn't kept in the repo, only
the generated `.ts` file under `comfy/workflows/` is.

### Adding your own workflow

1. Build and test it in ComfyUI. Give the nodes that take a parameter a title starting with `#` (`#PROMPT`, `#SEED`, …).
2. Export it with **Workflow → Export (API)**.
3. Generate a draft: `bun run comfy:convert comfy/my-workflow.json my-workflow --kind=image` (or `--kind=video`/`--kind=audio`).
4. Open `comfy/workflows/my-workflow.ts` and replace the values at the `TODO` comments with `opts` - prompt, seed,
   size, file name, and for videos the pictures and the audio.
5. `bun run typecheck`
6. Set `"imageWorkflow": "my-workflow"` (or `videoWorkflow`) in a project's `config.json` and render.

The full guide, with the options every workflow gets, the helpers and a checklist:
[docs/custom-workflows.md](docs/custom-workflows.md).

### Things to know

- **Run `bun run comfy:types` after installing nodes or models.** It regenerates `comfy/nodes.ts` with the SDK's
  `cfli codegen` and fixes custom nodes with duplicate output names on the way.
- **`comfy/nodes.ts` is generated and large** (about 4.3 MB). Don't edit it, and keep it out of version control.
- **Some connections aren't in the types:** node outputs into widgets, autogrow inputs like `ref_images.ref_image_0`,
  and widgets that depend on another widget. The helpers `widget()` and `withInputs()` cover them.
- **Hour-long renders are fine.** There's no time limit; completion is read from the server's history, so a dropped
  connection changes nothing. If FeverSlop TS stops while ComfyUI is still rendering (Ctrl+C, crash, sleep), the next
  run picks the job up again via `<file>.pending.json` instead of rendering it twice.
- **Clips are rendered slightly longer than their slot.** The H3 node only renders 5 + 17·k frames, so a full 10 s
  slot renders 10.13 s; the extra frames are cut off in the final video. Lower `MAX_CLIP_SEC` if your hardware limit is
  strict - the rounding adds up to 16 frames (0.67 s).
- **Model names are fixed in the workflow files.** Change them there, or copy a workflow under a new name.
- **Uploads and results pile up on the server** under `feverslop-ts/<project-id>/` in ComfyUI's `input/` and `output/`.
- **Several servers need the same models and nodes.** `comfy/nodes.ts` is generated from the first one.

More, and troubleshooting: [docs/comfyui.md](docs/comfyui.md#things-to-know).

## From plan to video

1. Render the pictures with `--render=images` - or generate every picture in `output/assets.json` yourself and save it
   under the listed name in the project folder (`assets/locations/<id>.png`, `assets/characters/<id>.png`).
2. Render the clips with `--render=videos` - or send every `output/clips/slot-XXX.json` to MiniMax H3 with the pictures
   and the audio from `assets`, **in the listed order** - the prompt refers to them by number.
3. Assemble them with `--render=final` into `<project-id>.mp4`. Rendered elsewhere? Save the clips as `videos/slot-XXX.mp4`
   first - each needs at least the clip's `frames`, starting at the audio of its `frameStart`.

Or all three at once: `bun index.ts --render=all`.

## Singing characters

In performance mode characters sing the lyrics on screen, lip-synced to the real vocals. Turn it on in
`config.json`:

```json
{"singers": ["auto"]}
```

- `["auto"]` - the LLM picks the lead singer from the cast (step 5b), usually one character, a group character like
  "Miners" if the lyrics are sung by a "we", two or three for a clear duet.
- `["Thorin"]` - one singer, by name or id. Names are matched loosely: `"thorin"`, `"Thorin"` and `"Thorin
  Oakenshield"` find `thorin-oakenshield`, `"miner"` finds `miners`. Unknown names are skipped with a warning - the
  run prints the cast.
- `["Thorin", "Brenna"]` - several singers; the LLM decides who sings which line, several at once for duet or choir
  lines.

What happens then:

1. **Stems** (`2a`): demucs `htdemucs_ft` separates the song into `stems/vocals.wav`, `drums`, `bass` and `other`.
2. **Transcript** (`2b`): Whisper large-v3 transcribes `vocals.wav` with word timestamps. The lyrics are given as the
   prompt, which makes sung words much easier to recognize.
3. **Lyrics timing** (`2c`): the known lyrics are aligned to the heard words, word by word and in order. Words Whisper
   missed get times between their neighbours. The run prints every line with its time and a confidence (the share of
   its words that were found), and warns about lines below 0.5.
4. **Timeline** (`10`): sections with vocals start at their first sung line (on the downbeat before it, for pickups),
   the instrumental sections fill the gaps - no more estimated section boundaries. Every clip gets the words sung in
   it.
5. **Beats** (`9`): the singers are on screen in beats under sung sections, with their face visible ("sings while
   forging the blade"). Clips with vocals always get their singers as subjects, even if a beat forgot them.
6. **Requests**: clips with vocals get the isolated vocals as `<Audio 2>`, the voice-timbre reference for the singer,
   speaker ids `(S1)`, `(S2)`, and one sentence per sung line at its real time:
   `At 00:02.300, <Subject 2> (S1) sings <d>[English] To the Well of Youth we march through the fire.</d> while …`.
   Shots in which a line starts frame the singer (medium shot to close-up, calmer camera); cuts that would fall into
   a sung word move to the next gap between words. Clips without vocals stay exactly as in clip mode.

`<Audio 1>` stays the full song part: it is the audio guide and the soundtrack, the final video still uses the
original song.

**Checking and fixing the timing.** Listen to a few line starts in the song and compare them with the table the run
prints (or `lyricsTiming.lines` in `project.json`). A wrong line can be fixed by hand there - `start`, `end` and the
words' times - then run with `--redo=timeline`. `--redo=transcript` transcribes again, `--redo=singing` recasts the
singers.

**First run.** `tools/vocals.py` installs PyTorch (CUDA 13.0 wheels - cu128 builds lack precompiled kernels for
RTX 50xx/Blackwell `sm_120`, which forces slow driver-side PTX JIT compilation) and downloads the
models: demucs ≈ 320 MB (htdemucs_ft is a bag of four models), Whisper large-v3 ≈ 3 GB. On an RTX 5090 the separation takes under a minute, the
transcription a few minutes. Both free the GPU memory as soon as they are done, so ComfyUI can use it right after.
Without CUDA they run on the CPU, much slower. On macOS there are no CUDA wheels - `tools/vocals.py` takes the regular
PyPI PyTorch there, so the audio pipeline installs and runs on the CPU.

## Band members and instruments

When a character's `prop` in `project.json` (step 5, `cast`) is a musical instrument that's actually heard in the
song, its on-screen use is grounded in whether that instrument is audible at each point in the song, instead of the
video model showing it played continuously through every shot:

```json
{ "id": "drummer", "name": "Drummer", "role": "…", "prop": "drum kit", "propStem": "drums" }
```

- `prop` - any distinctive object a character carries or uses (a weapon, a tool, an instrument, …), named briefly.
  Set for every visible band member, including backing musicians - step 5 is asked explicitly not to skip the
  drummer or other non-lead instruments.
- `propStem` - only for a `prop` that is a musical instrument actually part of the song: `"drums"` or `"bass"`;
  `"guitar"` or `"piano"` (separated from the `"other"` stem by a second, narrower demucs pass, step `5a`); or
  `"other"` (synth, strings and every other melodic instrument that pass doesn't cover - they share one activity
  signal since Demucs can't split them further). Leave empty for a non-instrument prop, an instrument not heard in
  the song, or whenever the story isn't a band performing live - the whole feature stays off then.

What happens, only when at least one character has a `propStem` **and** the lyrics are aligned (`alignLyrics`, see
[config.json](#configjson) - stems must already be separated):

1. **Instrument activity** (`5c`): the same RMS-energy activity detection used for the vocals stem
   (`tools/vocals.py activity`) runs on every stem a `propStem` claims (`drums.wav`, `bass.wav`, `other.wav`) -
   no extra model, just the stems already separated in step `2a`.
2. **Shots** (`11b`): for every beat, each on-screen character with a `propStem` gets one active/inactive flag per
   shot, from whether that stem is active over more than half the shot's estimated duration. The LLM is told to show
   the character actively using the prop only on an active shot - it picks the verb itself (playing, strumming,
   striking, …), nothing here is a fixed word list - and to have them hold it still, rest it or otherwise occupy
   their hands on an inactive one.

**Fixing a character's prop by hand.** If step 5 missed an instrument or bundled a costume detail into `prop` (e.g.
a mask worn alongside a guitar), edit `cast.characters` in `project.json` directly, then:

```bash
bun index.ts --redo=propActivity,shotMoments
```

This only re-runs the activity check and the per-shot rewrite - `cast`, `beats` and the character pictures are left
alone.

## Group characters

A cast entry can represent a collective acting as one individual member of a group - "Orcs", "Miners", a band's
backing dancers - rather than a single named person. Step 5 (`cast`) flags this itself:

```json
{ "id": "orcs", "name": "Orcs", "role": "…", "isGroup": true }
```

Without this, a group character still got only one reference image for the whole song, so every individual of it on
screen - in every shot, from the first appearance to the last - looked exactly the same. With `isGroup` set:

1. **Beats** (`9`): for every beat that puts a group character on screen, the LLM also estimates `groupSize` - how
   many distinct individuals of it are visible together at once (a lone scout is `1`, a raiding pack might be `4`).
2. **Member variants** (`9c`): the most simultaneous individuals seen anywhere in the story becomes how many member
   look prompts get generated (capped at 5, at least 2 for any flagged group) - each one written to look visibly
   different from the others already designed for that same group (a different build, face, hair or gear detail),
   the same way the main cast is already pushed apart from each other.
3. **Shots** (`12`): each clip rotates through a group's member pictures instead of resolving every shot to the same
   file, so the group doesn't render from one single shared face for the whole video.

**A species is one look.** Member variants are only for groups of recognizably different individuals (a crew of miners, a
crowd). A kind of creature - mole-men, a pack of wolves, a unit in one uniform - is flagged `"isGroup": true, "alike": true`:
one reference picture, one description, no variants, and the clip prompt says that every one of them looks like the
picture. For a project planned before this flag, set `alike` in `cast.characters` and run `--redo=characterLookVariants`
(and put the picture you want at `assets/characters/<id>.png`).

**Fixing this by hand.** If step 5 missed that a character is a group, or a beat's estimate is off, edit
`cast.characters`/`beats` in `project.json` directly, then:

```bash
bun index.ts --redo=characterLookVariants
```

**Fixing one member's picture specifically** (or any character's, group or not) - `bun run replace-character
<project-id>` walks through swapping in your own image and description interactively; see
[docs/comfyui.md → replace-character](docs/comfyui.md#replace-character).

## Known limits

- Section boundaries are estimated from the audio unless the lyrics are aligned. Check them against the song and fix
  `music.sections` in `project.json` if needed, then run with `--redo=timeline`.
- Without alignment, a section's lyric lines are spread evenly over its clips.
- The alignment is only as good as Whisper's hearing: growled, heavily layered or very fast vocals are recognized
  worse. Lines with low confidence have interpolated times - check them.
- If not a single lyric word is found in the transcript (a wrong `lyricsLanguage`, vocals that are too distorted, a
  song without singing), the alignment stops the run with an error instead of falling back to estimated times - with
  no heard word there is nothing to anchor an estimate to. Check `lyricsLanguage` and listen to `stems/vocals.wav`.
  In clip mode, `"alignLyrics": false` runs the project without the alignment; in performance mode (`singers`) the
  lyric timing is required, because the lip-sync needs to know when each line is sung.
- A line that is sung across a clip boundary is split between the two clips word by word.
- Instrument activity (`propStem: "other"`) is shared by every character on that stem - Demucs' 4-stem separation
  can't tell two guitarists apart, so a solo handoff between them isn't reflected individually.
