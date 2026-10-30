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

All TypeScript tools support `--help`, `--verbose`, `--debug`, `--quiet` and `--banner`.
See [CLI output and recovery](docs/cli.md) for logging, JSON output and terminal behavior.
See [performance statistics](docs/stats.md) for the compact dashboard, filters, comparisons and metric definitions.

| Script                  | What it does                                                                 |
|-------------------------|------------------------------------------------------------------------------|
| `bun run setup`         | connects the LLM server and the ComfyUI servers - see [Setup](#setup)        |
| `bun run init`          | creates a new project - see [Creating a project](#creating-a-project)        |
| `bun run example`       | creates a random example project and generates its song - see [Creating a project](#creating-a-project) |
| `bun run status <id>`   | where a project stands: steps done or redone by the next run, renders missing or stale, the next command - `--film` for a film |
| `bun run inspect <id> <clip>` | one clip on one screen: its beat and staged shots, pictures and audio, render state and prompt - `--film` for a film |
| `bun run replace-character <id>` | swap a character's picture and description for your own - see [docs/comfyui.md](docs/comfyui.md#replace-character) |
| `bun run import-asset <id>` | take a finished character or place from another project or the library - see [Taking a character or place from another project](#taking-a-character-or-place-from-another-project) |
| `bun run export-asset <id> <asset>` | put a finished character or place into the library - see [The asset library](#the-asset-library) |
| `bun run create-asset <kind> <id> --anchor=…` | a new library asset from a picture, no project needed |
| `bun run leak-scan <id>` | finds rendered clips that came out as the reference pictures lined up, prints the command to render them again |
| `bun run interpolate <id> --only=… --model=…` | compares frame interpolation models on some clips - see [Measuring and comparing](#measuring-and-comparing) |
| `bun run stats`         | render and LLM timings of all projects: medians, outliers, tokens, prices - see [Measuring and comparing](#measuring-and-comparing) |
| `bun run film:init`, `bun film.ts <id>` | the short-film pipeline - see [docs/film.md](docs/film.md) |
| `bun run styles:doc`    | regenerates [docs/style-examples.md](docs/style-examples.md) from `lib/styles.ts` |
| `bun test`              | the unit tests |
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
| `bun run setup vision`    | the model that describes pictures: the text model, another model on the text server, or one on another server - says whether it takes pictures |
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
- `llm.vision` (optional): the model that describes pictures (`replace-character`, `import-asset`, `create-asset`) -
  for a text server that runs without a vision projector. `{"url": …, "apiKey": …, "model": …}`: without `url` it is
  the text server (and its key) with another model, without `model` the server's only model. Without `llm.vision` the
  text model describes the pictures. Before the first picture the server is asked whether the model takes pictures
  (llama.cpp `/props`, Ollama, LM Studio) - one that does not stops right there and says what to set; a server that
  cannot tell is simply tried.
- A complete example with every optional block - the vision model of its own, a second ComfyUI server behind a proxy:

  ```json
  {
    "llm": {
      "url": "http://localhost:8080/v1", "model": "Muse-Glimmer-30B-GGUF", "parallel": 1,
      "vision": {"url": "http://localhost:8081/v1", "model": "Qwen3-VL-8B"}
    },
    "comfy": ["http://localhost:8188", {"url": "https://gpu2.lan:8188", "name": "gpu2", "token": "…"}]
  }
  ```

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
| `FEVERSLOP_VISION_URL`                 | -                 | the server that describes pictures, with `/v1`    |
| `FEVERSLOP_VISION_API_KEY`             | -                 | its API key                                       |
| `FEVERSLOP_VISION_MODEL`               | -                 | the model that describes pictures                 |
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
- [docs/recipes.md](docs/recipes.md) – short answers to common tasks: fix one clip, portrait video, 60 fps, cheap iteration, the same band in every song
- [docs/style-examples.md](docs/style-examples.md) – every built-in style, to copy into `style.txt`
- [docs/minimax-h3-video-prompt-writing-guide.md](docs/minimax-h3-video-prompt-writing-guide.md) – the prompt format the clip requests follow
- [docs/development.md](docs/development.md) – for working on the code: layout, adding a step, tests, principles

## Creating a project

```bash
bun run init
```

An interactive wizard, in the same style as `bun run setup`: it asks for the song (an audio file to copy in, or one
to generate from a song idea or from lyrics of your own), the language of the lyrics, who sings it (a woman, a man, a
duet, or left open), lyrics and/or a story idea, who is seen singing, an optional visual style, the
aspect ratio of the video, and render settings: the defaults, a quick-test or a quality preset, or image/video
workflow, resolution and continuity one by one. A summary at the end lets you change any answer before it
writes `projects/<id>/`, prints the `bun index.ts` command to run and offers to start it (the whole run, or only a
generated song to listen to first).

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
    song.wav          required (or song.mp3, song.flac), unless generated with --render=song (see Generating the song)
    lyrics.txt        lyrics with section tags: [Intro], [Verse 1], [Chorus], ... and a blank line between sections
                      (see lyrics.txt below) - required, unless generated
    idea.txt          the song idea for --render=song - required for it unless lyrics.txt is given, otherwise unused
    music-style.txt   optional - musical direction for --render=song, e.g. genre/instruments/mood
    story-idea.txt    optional - the story to tell, see Story idea and music style below
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
  logs/               the whole output of every run, one file per run (<time>.log, without colours)
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
bun index.ts -v                       # every detail in the terminal - by default a cached step is one line and the clip
                                       # prompts are not printed (the log file in logs/ always has everything)
bun index.ts --show=cast,clips        # the details of these cached steps, clips = the clip prompts
bun index.ts --redo=beats --render=videos --dry-run   # what this would redo and render (with an estimate) - nothing is done
bun index.ts --review                 # stop after the story, the cast, the look and the beats when they were just generated:
                                       # accept, edit them in $EDITOR (text, or JSON for cast and beats), generate again, or stop
bun index.ts --render=all             # also render with ComfyUI and assemble <project-id>.mp4, see below
bun index.ts --export=mlt,openshot    # write timeline.mlt (Shotcut/Kdenlive) and/or timeline.osp (OpenShot): clips on one track, the song under them (or --export=all)
bun index.ts --gallery                # write projects/<id>/gallery.html: cast, storyboard and videos at a glance
bun index.ts --debug                  # a failure shows its stack trace below the error box (or FEVERSLOP_DEBUG=1)
bun index.ts --debug-audio            # also cut one listenable wav per track and clip into output/audio (not needed for rendering)
bun index.ts --legacy-moments         # skip steps 11a and 11b, spread beat.moments across shots the old way
bun index.ts --redo=propActivity,shotMoments   # re-check instrument activity after editing prop/propStem by hand
```

Finished steps are cached in `project.json` and skipped on the next run - a run that breaks halfway continues where it
stopped. The steps that ask the LLM once per element keep each answer the moment it is there (`partials` in
`project.json`): the looks per character and place, and the shot planning (`shotMoments`) per beat. A run stopped in
the middle of such a step (Ctrl+C, the computer shut down) goes on from the kept answers - **run it again without
`--redo`**; `--redo=…` drops them and asks everything anew. A kept answer is only used for the same question: a beat
whose blocking, music or film look changed is planned again. You can edit `project.json` by hand (a story beat, a look prompt, a section time) and run again; the H3
requests are always rebuilt from the current data.

Edited inputs are noticed: `project.json` keeps a fingerprint of every input, and a changed one redoes the steps
built on it (and everything built on those):

| Changed                       | Redoes                              |
|-------------------------------|-------------------------------------|
| `idea.txt`                    | `songStyle`                         |
| `music-style.txt`             | `songStyle`                         |
| `song.wav`/`.mp3`/`.flac`     | `music`, `stems`                    |
| `lyrics.txt`                  | `story`, `transcript`, `singing`, `songStyle` |
| `story-idea.txt`              | `story`                             |
| `style.txt`                   | `lookBrief`                         |
| `singers` in `config.json`    | `singing` (and so `beats`)          |
| `singerVoice`                 | `story` (and everything after it), `songStyle` |
| `lyricsLanguage`              | `transcript`                        |
| `continuity` in `config.json` | `blocking` (and so `shotMoments`)   |
| `fightClips`                  | `blocking` (and so `shotMoments`)   |
| `vocalGap`                    | `timeline` (and everything after it) |
| `locationView`, `sequenceSheets` | `shotViews`                      |

### lyrics.txt

A tag in square brackets starts a section, and **a blank line separates two sections**:

```
[Verse 1]
[Low, gravelly vocals]
The hammers are silent
The fires have gone cold

[Guitar Solo]

[Bridge]
Cold as ice and deep as time
```

- Tags on the lines right after each other are one section: the first names it (`Verse 1`), the others say how it sounds
  (`Low, gravelly vocals`), the way Suno writes its parts. Read as sections of their own, every description would cut
  the song at an invented boundary - the song analysis cuts it into exactly as many sections as there are.
- A section without sung lines (`[Guitar Solo]`) ends with a blank line too. Without it, the tag after it is read as
  one of its descriptions: `[Intro]` with `[Verse 1]` on the next line is one section, "Intro". A file that leaves out
  the blank lines between sections is read wrong - that is not detected.
- `(notes)` in round brackets are not sung.
- A project whose song was analyzed with one section per tag (before this rule) keeps that reading until
  `--redo=music`.

### Story idea and music style

Both files are free text, one or a few paragraphs, in any language. `story-idea.txt` says what happens and who is in the
video; the story step turns it (with the lyrics) into the story. `music-style.txt` is only for `--render=song`: genre,
instruments, mood, voice - the song-style step turns it into the YuE2 prompt.

```
# input/story-idea.txt
A lighthouse keeper's daughter rows out through the fog every night to a ship nobody else can see. The band plays on the
rocks below the lamp - four people, the singer in a tattered oilskin coat. At the end the ship is the lighthouse's reflection.

# input/music-style.txt
slow sea shanty turned doom folk: low male lead vocal, accordion, bowed double bass, one heavy floor drum, gang vocals in the chorus
```

### Generating the song

Without `input/song.wav`, `--render=song` writes it from `input/idea.txt` - or from lyrics of your own in
`input/lyrics.txt`, without an idea - before the rest of the pipeline runs:

1. **Lyrics** (step `1`, not cached) - only when `input/lyrics.txt` doesn't exist: an LLM writes lyrics with section
   tags from `idea.txt`, the target length (`songDuration` in `config.json`) and `lyricsLanguage`, into
   `input/lyrics.txt`. With `singerVoice` set they are written for that voice. From then on `lyrics.txt` is a plain input like `story-idea.txt` - edit it, or delete it to get
   new lyrics.
2. **Musical style** (step `1a`, `songStyle`) - an LLM turns the lyrics (+ optional `music-style.txt`) into a YuE2
   `style` prompt (comma-separated genre, instruments, mood, vocal gender, vocal tone) - the vocal gender is the one
   `singerVoice` gives, unless it is `"auto"`. It is written to
   `music-style.txt` only if that file doesn't exist yet, so a hand-written one is never overwritten. Redone whenever
   `idea.txt`, `music-style.txt`, `lyrics.txt` or `singerVoice` changed, or with `--redo=songStyle`.
3. **Song audio** (step `1b`) - renders the song with the YuE2 ComfyUI workflow (`songWorkflow` in `config.json`,
   default `yue2-song`) and writes `input/song.wav`. `songDuration` (default: the workflow's own, 360s) is only an
   upper bound - the model decides the actual song length.

Once `input/song.wav` exists, `--render=song` renders it again only when the lyrics or the style changed in this run.
To get a new song: edit `music-style.txt` or `lyrics.txt` (or delete `lyrics.txt` for new lyrics) and run
`--render=song` again. Without `idea.txt` and `lyrics.txt`, `song.wav` must be supplied by hand.

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
| 1  | –                | Lyrics from `idea.txt` → `input/lyrics.txt`, only when there is none ⁵            | –                            |
| 1a | `songStyle`      | YuE2 `style` prompt from the lyrics (+ optional `music-style.txt`) ⁵              | –                            |
| 1b | –                | Song audio rendered with the YuE2 workflow → `input/song.wav` ⁵                   | songStyle                    |
| 2  | `music`          | BPM, downbeats, energy per bar, song sections named after the lyrics tags         | –                            |
| 2a | `stems`          | demucs `htdemucs_ft` → `stems/{vocals,drums,bass,other}.wav` ¹                    | –                            |
| 2b | `transcript`     | Whisper large-v3 on `vocals.wav`, word timestamps, the lyrics as prompt ¹         | stems                        |
| 2c | `lyricsTiming`   | The known lyrics aligned to the transcript: start and end of every line and word ¹ | transcript                   |
| 3  | `story`          | Story from lyrics and/or story idea                                              | –                            |
| 4  | `summary`        | Short summary                                                                    | story                        |
| 5  | `cast`           | Characters and locations with ids, each character's `prop` and, if it's a heard instrument, its `propStem` ⁴ | story |
| 5a | `instrumentStems` | Guitar/piano separated from `other` with a second, narrower demucs pass, only for `propStem`s that need it ⁴ | stems, cast |
| 5b | `singing`        | The singers, and who sings which line ²                                          | cast                         |
| 5c | `propActivity`   | Bar-averaged energy activity ranges per instrument stem claimed by a character ¹ ⁴ | stems, cast, music          |
| 6  | `lookBrief`      | Film look for MiniMax H3: one format and style, palette, camera language - extends `style.txt` if there is one | summary |
| 7  | `characterLooks` | Krea 2 prompt per character (reference sheet, plain background)                  | cast, lookBrief              |
| 7b | `characterDescriptions` | The character look without the reference sheet - no pose, background, light or medium - for the clip prompts | characterLooks |
| 8  | `locationLooks`  | Krea 2 prompt per location (empty establishing shot)                             | cast, lookBrief, summary     |
| 8b | `locationDescriptions` | The location look without the establishing shot - no camera, "empty" or medium - for the clip prompts | locationLooks |
| 8c | `locationAnchors` | Two or three fixed features of each place, as one phrase - kept behind the people of every shot, so no shot falls back to the grey backdrop of the character pictures | locationDescriptions |
| 8d | `locationLayouts` | The fixed floor plan of each place and what each of the five views of its sheet shows of it - every beat in the place is staged in it (11b), and the views are chosen by it (11c) | locationLooks, locationDescriptions |
| 9  | `beats`          | Story beats without timing: moments, location, characters, intensity, continuity - the intensity follows the song's loudness and the instruments heard along the way | story, cast, singing, music, lyricsTiming, propActivity |
| 9c | `characterLookVariants` | One look prompt per member of a group character, each visibly different - see [Group characters](#group-characters) ⁷ | characterLooks, beats |
| 9d | `characterDescriptionVariants` | The member looks without the reference sheet, one per member, for the clip prompts ⁷ | characterLookVariants, characterDescriptions |
| 10 | `timeline`       | Song cut into clips on downbeats, as many bars as fit into `MAX_CLIP_SEC`; with the lyrics timing, real section starts and the words sung in every clip | music, lyricsTiming |
| 11 | `mapping`        | Beats stretched over the clips in story order, matching intensity to energy      | beats, timeline              |
| 11a | `blocking`      | The floor plan per beat and where everybody starts and ends, each beat from the end of the one before - one short call per beat, in order ³ ⁶ | beats, timeline, mapping, characterDescriptions, locationDescriptions, locationLayouts |
| 11b | `shotMoments`   | The staged shots per beat, from its blocking: per shot the action, who is in the picture and where they stand and move, replacing `beat.moments` - the beats at once; `--redo=shotMoments` keeps the blocking ³ | blocking, beats, timeline, mapping, propActivity, singing, characterDescriptions, locationDescriptions, locationLayouts |
| 11c | `shotViews`     | Per shot the view of the place's reference sheet (front, right, behind, left, wide) it is in, from the text of the plan ⁸ | shotMoments |
| 12 | –                | MiniMax H3 requests, built deterministically, never cached                       | everything                   |

¹ only when the lyrics are aligned (`alignLyrics`, on when someone sings) · ² only when someone sings ·
³ skipped with `--legacy-moments`, which spreads/reuses `beat.moments` across shots instead (the old behavior) ·
⁴ only when at least one character's `prop` is a musical instrument actually heard in the song - see
[Band members and instruments](#band-members-and-instruments) ·
⁵ only with `--render=song`, and only while `input/song.wav` doesn't exist yet - see
[Generating the song](#generating-the-song) ·
⁶ made only when the shots are planned - a project whose shots were planned before the step existed keeps them and
has no blocking until `--redo=shotMoments` (or anything that redoes it). A beat whose blocking stays unusable plans its
own staging in 11b ·
⁷ only for a group character (`isGroup`) that is not `alike` ·
⁸ only with `"locationView": "auto"` (the default) and `sequenceSheets`

Steps 1, 1a, 3–9 (with 8c, 8d, 9c, 9d), 11a, 11b and 11c use the LLM (5b only for `"auto"` or several singers), all others
are plain code.

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

#### Finishing (`finish`)

With `"finish"` set, a finished copy is written next to every final video (`<name>-finished.mp4`, also for the
`finalFps` one); the video itself stays as it is. ffmpeg only, no ComfyUI. In this order:

1. **Color match** (`colorMatch`, 0-1, off by default): the clips come out with their own exposure and tint, so a cut can
   jump in brightness. Every clip is measured in the joined video (black and white of the luma, mean of the chroma,
   every 6th frame, not the frames right at a cut) and moved that part of the way to one reference - the median of all
   clips, or the clip `colorReference` names. `1` removes the jumps, but also the mood of a darker or warmer scene;
   `0.5` halves them.
2. **Grade:** black level, white level, contrast, saturation - against the lifted blacks the clips come out with.
3. **Sharpen:** ffmpeg `cas`.
4. **Grain** (`grain`, 0-100, off by default, ~3 is light): film grain over everything, after the sharpen.

```json
"finish": true
"finish": {"colorMatch": 0.5, "grain": 3}
"finish": {"colorMatch": 1, "colorReference": "slot-014", "sharpen": 0.3}
```

`true` is the "mild" finish (black level 0.025, white level 0.98, contrast and saturation 1.03, CAS 0.4, no color match,
no grain); an object is the mild one with its own fields replaced. Measured on tides (53-87 s, slots 012-018), the mean
jump of black + white at a cut:

| Finish                      | mean | max  |
|-----------------------------|------|------|
| mild                        | 11.3 | 31.3 |
| mild + `colorMatch` 0.5     | 5.6  | 15.6 |
| mild + `colorMatch` 1       | 0.5  | 0.6  |

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
- A changed `continuity` redoes `blocking` and `shotMoments`.
- As a reference picture the frame carries the room and the people, but not the exact pose and framing of the frame:
  the clip may start from a different position. `pinStartFrame` (on by default) locks it to the frame at frame 0 (`MiniMaxH3AddGuide`
  with the image); a clip then starts on the exact frame the one before ends on. With `pinStartFrame` the frame is
  **not** also one of the reference pictures (the same image twice made the model blend it in a second time, shifted).

#### Context frames (`contextFrames`)

One pinned frame carries the pose, not the movement: the people of a continuing clip start moving anew. With
`"contextFrames": 22` (or `39`; 5 + 17·k) a continuing clip starts on the **last frames** of the clip before instead:

- they are cut out of the clip before as a short video (`assets/clips/<id>_tail<n>.mp4`) and locked to the start of the
  new clip as a frame batch (`MiniMaxH3AddGuide`, ComfyUI's own nodes - the node places 5 + 17·k frames as consecutive
  frames); the two-pass workflow sets them in both passes
- the batch ends 3 frames before the end of the clip before (`CONTEXT_SETTLE`): the first frames the model draws after
  a batch flash brighter, and those fall into the part that is cut off
- the clip is rendered that much longer at the head (22 + 3 frames ≈ 1 s), every time in its prompt moves by it, and the
  head is cut off again after the render - the file starts on the clip's own first frame, the final video, the boundary
  frames and the frame interpolation are unchanged
- drawn on its own the clip has its own exposure: it is matched as a whole to the last 4 frames of the clip before -
  black and white of the luma, the mean of the chroma (`lib/colormatch.ts`, ffmpeg `lutyuv`)

It replaces `pinStartFrame` for those clips and is **off by default** (`0`). Measured on tides-of-eternal-flame (same
seed, two-pass, two transitions):

| | pinned last frame | 22 context frames |
|---|---|---|
| brightness across the transition | steps by 3-4 levels (81 → 79, 75 → 72) | no step after the color match (81 → 81.6, 75 → 75.0) |
| movement after the transition | in the guitar solo restless: frame-to-frame change 7-8 against 5 in the clip before | goes on as before (3-5) |
| the transition itself | the exact last frame - no jump | a small jump in position: the model draws the overlap a little differently |
| render time | as the clip | ~1 s more to render: 9-15 min instead of 7 for an 8 s two-pass clip on the RTX 5090 (shared GPU) |

Worth it where people move through the transition (a solo, a walk); for a still group shot the pinned frame is as good.

### config.json

Settings per project, all optional - read at every run and checked field by field:

```json
{
  "singers": [],
  "singerVoice": "auto",
  "lyricsLanguage": "en",
  "alignLyrics": false,
  "continuity": "never",
  "pinStartFrame": true,
  "locationView": "auto",
  "fightClips": false,
  "vocalGap": 1.5,
  "leakRetries": 0,
  "seed": -1,
  "imageResolution": -1,
  "videoResolution": -1,
  "videoAspect": "16:9",
  "imageWorkflow": "kroma-image",
  "videoWorkflow": "h3-ref2video",
  "sequenceSheets": true,
  "sequenceWorkflow": "h3-sequence-to-sheet",
  "songWorkflow": "yue2-song",
  "songDuration": -1,
  "songAudio": true,
  "finalFps": 24,
  "interpolationModel": "rife_v4.26_heavy.safetensors",
  "llm": {}
}
```

| Field                                 | Values                                                                                                    |
|---------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `llm`                                 | `{"model": "…"}` = another model of the LLM server for this project; default `{}` = the one from the [settings](#setup) |
| `singers`                             | `[]` = clip mode (default), `["auto"]` = the LLM picks the lead singer, `["Thorin", "brenna"]` = these characters, by name or id - see [Singing characters](#singing-characters) |
| `singerVoice`                         | voice of the song: `"auto"` (default) = as the story has it, `"female"` / `"male"` = everybody who sings is a woman / man, `"mixed"` = a duet of one woman and one man. The story is written around it - changing it redoes the story and everything after it |
| `lyricsLanguage`                      | language of the lyrics as a code, `"en"` (default), `"de"`, … - for Whisper, the `<d>[English]` lyrics tag, and the song brief (`--render=song`) |
| `alignLyrics`                         | `true` = stems, transcript and real lyric timing; default: `true` when someone sings, else `false`. Set it to `true` in clip mode to place the lyric cues at the right moments |
| `continuity`                          | `"never"` (default) = every clip is its own cut, `"auto"` = the beats the story planning marked `continuous` run on without a cut, `"always"` = every clip but the first of each beat starts on the last frame of the clip before it. Off by default: the picture drifts from clip to clip and the next one starts on the drift - see [Continuous scenes](#continuous-scenes) |
| `pinStartFrame`                       | `true` (default) = a continuing clip is locked to the last frame of the clip before it as its first frame (`MiniMaxH3AddGuide`, `h3-ref2video`); `false` = that frame is only one of the reference pictures, which carry the room and the people but not the pose - see [Continuous scenes](#continuous-scenes) |
| `contextFrames`                       | `0` (default) = off; `22` or `39` (5 + 17·k) = a continuing clip starts on that many of the last frames of the clip before instead of its one last frame - the movement goes on, not only the pose. The clip is rendered that much longer at the head (~0.9 / 1.6 s), the head is cut off again; replaces `pinStartFrame` for those clips. Needs `continuity` - see [Continuous scenes](#continuous-scenes) |
| `locationView`                        | `"auto"` (default) = the shot planning chooses one of the five views of the place for every shot (step `shotViews`, 11c) and a clip gets the one of its first shot as its place picture; `-1` = the whole reference sheet (all five views side by side - the video model shows that back as a grid with a black patch in the first seconds), `0`-`4` = that one view for every clip (front, right, behind, left, wide). Needs the sequence sheets (`sequenceSheets`, on by default) - without them the picture is the plain one. The choice is made from the text of the plan and the names of the views, never from the pictures: a language model that cannot read images is enough, and it is deliberately kept that way |
| `fightClips`                          | `false` (default) = fight beats are cut like every beat; `true` = the clips of a fight beat (a "hit" with a crowd of creatures) are cut into one-bar pieces with one shot each and only the people of the shot as references - see `docs/comfyui.md` |
| `vocalGap`                            | `1.5` (default) = a clip whose singing starts more than 1.5 s after its start is cut where the voice comes in (on the downbeat right before it when that is within 0.3 s), one whose singing stops more than 1.5 s before its end is cut where it stops - the silence becomes a clip of its own, and two silent pieces next to each other one clip. A generation that opens on seconds of silence starts the lip movement early, whatever the prompt says. More clips: 42 instead of 33 on tides. `0` = off. Needs the lyrics timing (`alignLyrics`); a project made before keeps its clips until `--redo=timeline` |
| `leakRetries`                         | `0` (default) = off; `1` or more = a clip that came out as the reference pictures lined up on their grey backdrop is rendered again with another seed, that many times at most (needs `"seed": -1`). Already rendered clips: `bun run leak-scan <project-id>` - see `docs/comfyui.md` |
| `seed`                                | `-1` = random for every render (the seed used is saved in the `.json`), `0` or more = fixed              |
| `imageResolution`, `videoResolution`  | `-1` = the workflow's own size, `1.1` = megapixels, `"1920x1088"` = fixed size                            |
| `videoAspect`                         | the clips' aspect ratio: `"16:9"` (default, landscape), `"9:16"` (portrait), `"2:1"`, `"2:3"`, … - megapixels are computed in it, a `"WIDTHxHEIGHT"` keeps its own ratio and is turned to its orientation |
| `imageWorkflow`, `videoWorkflow`, `songWorkflow`, `sequenceWorkflow` | a workflow file in `comfy/workflows/`, without `.ts` - see [Workflows](#workflows) |
| `sequenceSheets`                      | `true` (default) = every character and place gets a multi-angle reference sheet (a turnaround video, sampled into frames) instead of one flat picture - see [docs/comfyui.md](docs/comfyui.md#reference-sheets); `false` = one plain picture each, cheaper while trying things out |
| `songDuration`                        | `--render=song`: an upper bound in seconds for the generated song - the model decides the actual length; `-1` = the workflow's own default (360s for `yue2-song`) |
| `finalFps`                            | `24` (default) = one final video at 24 fps; `60` (or `48`, `30`, …) = also `<project>-60fps.mp4`: every clip gets more frames by frame interpolation on ComfyUI, shot by shot (never across a cut - the cuts are read from the picture), kept in `videos/interpolated/`. A ComfyUI job per clip (~1 min for an 8 s clip at 1080p on an RTX 5090) |
| `finish`                              | `false` (default) = off; `true` = a light grade and sharpen of the final video(s), written as `<name>-finished.mp4` next to them: black level 0.025, white level 0.98, contrast and saturation 1.03, CAS sharpen 0.4 (the "mild" one - stronger looked overdone on tides); `{"sharpen": 0.3}` changes single fields (`blackLevel`, `whiteLevel`, `contrast`, `saturation`, `sharpen`, `colorMatch`, `colorReference`, `grain`) - see [Finishing](#finishing-finish). The clips come out with lifted blacks (level ~29 instead of 16), whatever the prompt says about haze. Off in `true`, to be switched on as fields: `colorMatch` (0-1) = every clip that part of the way to one reference in black, white and mean color, so the cuts do not jump - the reference is the median of all clips, or the clip `colorReference` names (`"slot-014"`); 1 removes the jumps, but also the mood of a darker or warmer scene, 0.5 halves them (tides: the mean jump of black + white at a cut 11.3 -> 5.6). `grain` (0-100, ~3 is light) = film grain over everything, last |
| `interpolationModel`                  | the model for `finalFps`, a file in ComfyUI's `models/frame_interpolation/`: `"rife_v4.26_heavy.safetensors"` (default), any RIFE 4.25/4.26 or `"film_net_fp16.safetensors"` - from Hugging Face `Comfy-Org/frame_interpolation` |
| `songAudio`                           | final video: `true` = the original song replaces the clips' audio (default), `false` = keep the clips' audio |

Characters are always portrait, locations landscape - whichever way round the size is written. Videos are landscape
unless `videoAspect` says otherwise, and always 24 fps. Details, examples and the resulting sizes: [docs/comfyui.md](docs/comfyui.md#project-config-configjson).

The fields `singers`, `singerVoice`, `lyricsLanguage`, `alignLyrics`, `continuity`, `locationView`, `fightClips` and `vocalGap` change
the plan (see the table of inputs under [Usage](#usage)); all others only change how it is rendered.

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
| `h3-ref2video-full` | video | `h3-ref2video` without the turbo LoRA, as the non-turbo branch of ComfyUI's template `video_minimax_h3_r2v`: res_multistep, simple, 20 steps, no shift - about 2.5× the sampling time, more detail for people far from the camera: `"videoWorkflow": "h3-ref2video-full"` |
| `h3-ref2video-2pass` | video | two passes: the base model for 20 steps at a quarter of the final pixels, the video latent x2 with `MinimaxH3LatentUpscaler3D` (`minimax_h3_latent_upscaler_3d_bf16`), then the base model again for 4 steps (euler/beta, denoise 0.2, noise seed + 1, no turbo LoRA - it left a crosshatch on skin) at the final size, song and first frame anchored again on the large latent. `videoResolution` is the final size (`-1` = 2 MP, pass 1 at 0.5 MP): `"videoWorkflow": "h3-ref2video-2pass"` |
| `h3-ref2video-cpu-clip` | video | `h3-ref2video` with the text encoder on the CPU - for a GPU whose VRAM doesn't hold the encoder next to the model |
| `h3-sequence-to-sheet` | sequence | the turnaround video of a reference sheet (`sequenceWorkflow`, default) |
| `frame-interpolate` | interpolation | RIFE/FILM frame interpolation per shot, for `finalFps` (not set in `config.json`, always this one) |
| `yue2-song`     | audio | `audio_yue2_text2music.json`                       |
| `h3-ref2video-film`, `h3-ref2video-film-beta`, `h3-ref2video-film-2pass` | video | the short-film pipeline's clips, without audio input (`-2pass`: the two passes of `h3-ref2video-2pass`) - see [docs/film.md](docs/film.md) |

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
{ "id": "drummer", "name": "Drummer", "role": "…", "prop": "drum kit", "propStem": "drums", "propCarried": false, "propInHand": "drumsticks", "propPlace": "stage" }
```

- `prop` - any distinctive object a character carries or uses (a weapon, a tool, an instrument, …), named briefly.
  Set for every visible band member, including backing musicians - step 5 is asked explicitly not to skip the
  drummer or other non-lead instruments.
- `propStem` - only for a `prop` that is a musical instrument actually part of the song: `"drums"` or `"bass"`;
  `"guitar"` or `"piano"` (separated from the `"other"` stem by a second, narrower demucs pass, step `5a`); or
  `"other"` (synth, strings and every other melodic instrument that pass doesn't cover - they share one activity
  signal since Demucs can't split them further). Leave empty for a non-instrument prop, an instrument not heard in
  the song, or whenever the story isn't a band performing live - the whole feature stays off then.
- `propCarried`, `propInHand`, `propPlace` - `propCarried: false` for a `prop` that is too big or too fixed to be carried
  (a drum kit, an organ, an anvil): it stands in the location `propPlace` (an id) and is used there. The character
  picture then shows only `propInHand` (e.g. drumsticks), the location picture shows the object itself at one fixed
  spot. Unset for a carried prop, which the character picture shows in use - held the way it is while used, with
  each of its `hands` named where it is at work (the LLM checks the finished look and asks once more if not).
- `hands` - what the character holds and plays things with, when it is not hands: `"paws"`, `"tentacles"`,
  `"sprinkle-covered arms"` for a donut. The look, the shot planning, the idle poses and the close-up of the playing
  use it, so nobody is given hands the story does not give them. Unset = hands (every project planned before).

What happens, only when at least one character has a `propStem` **and** the lyrics are aligned (`alignLyrics`, see
[config.json](#configjson) - stems must already be separated):

1. **Instrument activity** (`5c`): every stem a `propStem` claims (`drums.wav`, `bass.wav`, `guitar.wav`, …) is
   decoded with ffmpeg and its energy averaged over one bar, so a groove counts as playing between its hits. A stretch
   is active where that level is at most 20 dB below the stem's own loud bars and above -50 dBFS (the bleed of the
   other instruments in a separated stem) - no extra model, just the stems already separated in step `2a`. Projects
   from before this keep their old ranges until `--redo=propActivity` (which also redoes `shotMoments`).
2. **Shots** (`11b`): for every beat, each on-screen character with a `propStem` gets one active/inactive flag per
   shot, from whether that stem is active over more than half the shot's estimated duration. The LLM is told to show
   the character actively using the prop only on an active shot - it picks the verb itself (playing, strumming,
   striking, …), nothing here is a fixed word list - and to have them hold it still, rest it or otherwise occupy
   their hands on an inactive one. On an active shot its `playing:` field says what the hands do on the instrument
   (a short phrase); a bare "yes", or "no" for a heard instrument, is asked again once. Whether the phrase and the
   motion really play it - not "sticks held rigid" or "pick hand frozen over the strings" - is read by one short LLM
   call per beat, thinking off (`lib/playing-check.ts`); a "no" is asked again once like the other problems.
   Being heard puts nobody in the picture: a shot shows who it is about, the other players are heard off camera
   (their track then drives nobody's hands). Someone whose instrument stands in the place is only in a shot together
   with it. A close shot holds at most two people, a medium shot three - a plan with more is asked again once. The clip prompt then always
   states the playing for everyone whose stem is heard in the shot, with that phrase - also when the shot's action
   names them doing something else. Plans from before keep a generic "is actively using the …" until
   `--redo=shotMoments`.

**Fixing a character's prop by hand.** If step 5 missed an instrument or bundled a costume detail into `prop` (e.g.
a mask worn alongside a guitar), edit `cast.characters` in `project.json` directly, then:

```bash
bun index.ts --redo=propActivity,shotMoments
```

This re-runs the activity check, the story beats (they are told whose instrument is heard where) and everything after
them - `cast` and the character pictures are left alone.

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
4. **Several at once** (`12`): a beat whose `groupSize` is more than 1 gets that many member pictures in its clips (as
   many as there are), each a subject of its own - `<Subject 2>` is the group and the member in `<Picture 2>`,
   `<Subject 3>` "another one of the Orcs" in `<Picture 3>`, and so on. With one picture, two of the group in one frame
   came out as the same person. The text names the group by its own subject; wherever it is in the frame, the others
   are named with it ("with <Subject 3> and <Subject 4> beside them"). They only take the picture slots left over (9 in
   all) - a member gives way before anybody else. A group of one look (`alike`) or one of them at a time stays one subject.

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

### Taking a character or place from another project

A character or a place that is already finished in another project - the same band in the next song, another version
of the same video - is copied over instead of rendered again:

```bash
bun run import-asset <project-id>                                          # asks for everything
bun run import-asset <project-id> kael --from=tides-of-eternal-flame-261016:kaelen
```

- The picture (`assets/<kind>s/<id>.png`) and the whole reference sheet (`assets/sequence/<kind>s/<id>/`: anchor,
  sequence video, frames) are copied and renamed to the id the character or place has in this project. The copies are
  pinned (`"source": "user"` in their `.json`): never reported stale, never rendered again. The project's own pictures of
  it go to `old/attempts/` - nothing is deleted. No GPU, no render.
- The description used in the clip prompts is asked for: the other project's (written for exactly this picture), this
  project's own, or written from the picture by a vision-capable model. A place also takes the other project's
  background features and floor plan (with what each view of its sheet shows) when it has them.
- The plan built on the old texts stays as it is - the tool prints the `--redo` that makes it again (e.g.
  `--redo=shotMoments`), the clips already rendered with the old pictures are listed (they count as stale).
- The project must be planned (`project.json` with the cast). The character keeps this project's name, role and prop -
  the tool warns when the description does not name the prop, or gives another gender than the story. Group members
  are not imported one by one; use `replace-character` for them.

### The asset library

Finished characters and places that every project can take - the same band in every song, the same stage - live in
`library/` next to `projects/` (another folder: `"library": "D:/my-library"` in the settings file, or the env var
`FEVERSLOP_LIBRARY`). A project always gets a copy, so it stays complete without the library.

```bash
bun run export-asset tides-of-eternal-flame-261017 kael                     # into the library as "kael"
bun run export-asset tides-of-eternal-flame-261017 underwater-basilica-and-temple-stage --as=temple-stage
bun run import-asset new-song guitarist --from=library:kael                # from the library into a project
bun run export-asset witch-test leo --film                                  # a film's character (or its look "leo--wasted", or a place) into the library
```

- `export-asset` copies the picture and the whole sheet with the texts that go with them: the description, for a place
  its background features and floor plan. An asset already in the library is never overwritten - `--as=<id>` gives the
  new one another id. The project must have rendered the pictures and written the description.
- In the library: `library/<characters|locations>/<id>/asset.json` (name, description, background features, floor plan,
  where it came from), `picture.png` (the sheet) and `sheet/` (anchor, sequence video, frames).
- `import-asset` offers the library as a source, before the projects; its description is the one in `asset.json`.

**A new library asset from a picture** - no project needed:

```bash
bun run create-asset character singer-red --anchor=pictures/singer.png --name="Elara" --role="lead singer"
bun run create-asset location temple-stage --anchor=pictures/stage.png --like=tides-of-eternal-flame-261017
```

- The picture becomes the anchor as it is. A vision-capable model describes it - shown and editable before it is kept;
  `--description=…` gives your own instead (and runs without a terminal). A character is described once more after its sheet
  is made, from the anchor and the full-body views of the sheet - the clips are given the sheet, and an anchor cut at the waist
  says nothing of the legs and shoes. The description names every garment from top to bottom (sleeves, the length of a skirt).
- A place also gets its background features and its floor plan, with the same prompts a project uses.
- ComfyUI renders the reference sheet (sequence video, frames, picture) from the anchor - with the render settings of
  the project given with `--like`, else the defaults. It is made in `library/.work/` and moved into the library when it
  is done; an id the library already has is refused before anything is made.

### casting.json - who plays each role

Right after the cast step (5) the first run writes `projects/<id>/casting.json` - every character and place the
story has, each played by the project itself:

```json
{
  "characters": {"elara": "project:elara", "kael": "project:kael"},
  "locations": {"stage": "project:stage"}
}
```

The pipeline never writes it again: from then on it is yours, and only read. Change an entry to a library asset and
the next run uses it:

```json
"kael": "library:kael-red"
```

- `project:<id>` - as always: the project makes the look, the description and the picture of it when they are missing.
- `library:<id>` - the library asset is copied into the project once, renamed to the role's id and pinned (never
  rendered again); the project's own pictures of it go to `old/attempts/`. Its description - for a place also its
  background features and floor plan - is used instead of making one; no look, no picture is made for it. The role
  keeps its name, role, prop and voice from the story; a library picture that does not name the role's prop is warned
  about. `project.json` remembers which version was copied (`castingCopies`): the next runs copy nothing while the
  entry and the library asset stay the same.
- A `library:` entry the library does not have, or an entry that is neither `project:` nor `library:`, stops the run
  before anything is made - a typo never generates a picture.
- Characters and places without an entry run as `project:` (named in the log); an entry for nobody of the cast is warned
  about on every run; a group character is always made by the project.
- Back to `project:` - the library pictures are put away in `old/attempts/`, the run names the `--redo` that makes the
  role's own look and description.
- Changed after the shots were planned: the plan was made with the old texts - the run names the `--redo` that plans
  again (it is not done by itself, it costs). Cheapest is to cast right after the first run with `--review`, before the
  shot planning.
- Deleting `casting.json` writes it again on the next run, every entry `project:`.

### The asset tools at a glance

| Command | Needs | Does |
|---------|-------|------|
| `bun run replace-character <project-id>` | a terminal, a planned project | your own picture (and description) for one character or group member of the project |
| `bun run import-asset <project-id> [<id>] [--from=<project>[:<id>] \| --from=library:<id>]` | a terminal, a planned project | a finished character or place from another project or the library, copied and pinned |
| `bun run export-asset <project-id> <id> [--as=<library id>] [--film]` | rendered pictures and a description | the character or place into the library - `--film`: of a film in `films/` |
| `bun run create-asset <character\|location> <library id> --anchor=<picture> [--name=…] [--role=…] [--description=…] [--like=<project>]` | ComfyUI for the sheet | a new library asset from a picture, no project needed |
| `casting.json` | - | which roles of a project or a film are played by library assets, on every run |

- **Describing a picture needs a vision-capable model** - `replace-character`, `import-asset` (when asked to write the
  description from the picture) and `create-asset` send the picture to it: the text model, or the one in `llm.vision`
  (`bun run setup vision`, see [Setup](#setup)) when the text server runs without a vision projector. Without one, type
  the description (`--description=…` for `create-asset`), or take the one that came with the asset.
- **A place from your own picture:** `replace-character` is for characters only. Make the place a library asset with
  `bun run create-asset location <id> --anchor=<picture>`, then cast it in `casting.json`
  (`"<place id>": "library:<id>"`) or take it in with `import-asset … --from=library:<id>`.
- After every tool the plan built on the old texts stays as it is - the tool prints the `--redo` that plans again, and
  clips rendered with the old picture count as stale (`--render=videos --refresh=clips`).

## Measuring and comparing

Every render and every LLM call is timed into one file for all projects, `timings.jsonl` next to the settings file
(another one: `FEVERSLOP_TIMINGS=<path>`). It holds numbers and names only - never a prompt, an answer or a picture.
`--dry-run` and `bun run status` take their time estimates from it.

```bash
bun run stats                                   # compact overview, benchmark median and inclusive warm p90
bun run stats --compare                         # comparable workloads against the first warm GPU group per variant
bun run stats --by=resolution --kind=clip       # clips only, by resolution (also: workflow|variant|server|gpu, several
                                                # joined with a comma, e.g. --by=workflow,gpu)
bun run stats --project=<id> --since=7d --sort=p90 --top=10
bun run stats --details                         # cleaned p90, all groups and token breakdowns
bun run stats --kind=clip --json                 # filtered machine-readable report
```

Costs are estimated for calls with complete reported usage and configured model prices; currencies are totaled separately.
See [stats metric definitions and options](docs/stats.md), including `--baseline` and partial-data coverage.
Configure `prices` in the settings file per model id:

```json
{"prices": {"Muse-Glimmer-30B-GGUF": {"inputPerMillion": 0.2, "outputPerMillion": 0.6, "currency": "EUR"}}}
```

Before switching `finalFps` on, compare interpolation models on a few rendered clips - each model writes its own file
into `videos/interpolated/`, with a 60 fps copy with the song under it to watch:

```bash
bun run interpolate <project-id> --only=slot-018 --model=rife_v4.26_heavy.safetensors,film_net_fp16.safetensors
```

## Known limits

- Section boundaries are estimated from the audio unless the lyrics are aligned. Check them against the song and fix
  `music.sections` in `project.json` if needed, then run with `--redo=timeline`.
- Without alignment, a section's lyric lines are spread evenly over its clips.
- The alignment is only as good as Whisper's hearing: growled, heavily layered or very fast vocals are recognized
  worse. Lines with low confidence have interpolated times - check them.
- A word Whisper heard twice (an echo, a backing voice, a repeat) can be matched to the wrong place. When more than 4
  bars of silence part it from the rest of its line, it is put right next to the rest as a guess, so neither the line
  nor its section starts or ends bars away. Projects aligned before keep the old times until `--redo=lyricsTiming`
  (which also redoes the beats and everything after them).
- If not a single lyric word is found in the transcript (a wrong `lyricsLanguage`, vocals that are too distorted, a
  song without singing), the alignment stops the run with an error instead of falling back to estimated times - with
  no heard word there is nothing to anchor an estimate to. Check `lyricsLanguage` and listen to `stems/vocals.wav`.
  In clip mode, `"alignLyrics": false` runs the project without the alignment; in performance mode (`singers`) the
  lyric timing is required, because the lip-sync needs to know when each line is sung.
- A line that is sung across a clip boundary is split between the two clips word by word.
- Instrument activity (`propStem: "other"`) is shared by every character on that stem - Demucs' 4-stem separation
  can't tell two guitarists apart, so a solo handoff between them isn't reflected individually.
