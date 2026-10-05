# Short films (experimental)

`film.ts` turns a **story idea** or a **screenplay** (in any language) into a short film plan: screenplay, characters
with looks and voices, locations. It is a separate pipeline next to the music-video one (`index.ts`) and shares only the
LLM client, the settings and a few helpers with it. Films live in `films/<id>/`, not in `projects/`.

**Status: stage 1 of the plan - text only, no GPU.** The steps below run today; reference pictures, the shot plan, clip
requests and rendering are still to come (see [What's next](#whats-next)).

## Quick start

Needs [Bun](https://bun.com) and an LLM server - the same one as the music-video pipeline (`bun run setup llm`, see the
[README](../README.md#setup)). No ComfyUI, ffmpeg or uv yet.

| Command | What it does |
|---------|--------------|
| `bun install` | once |
| `bun run setup llm` | once: connect the LLM server |
| `bun run film:init` | create a film: idea or screenplay, style, length, language, resolution |
| `bun film.ts <film-id>` | run all steps; finished steps are cached, an edited input redoes what depends on it |
| `bun film.ts <film-id> --redo=cast` | redo a step and everything built on it (several: `--redo=outline,screenplay`) |
| `bun film.ts <film-id> --llm-model=… --llm-url=… --llm-key=…` | another LLM for this run only |

`bun run film <film-id>` is the same as `bun film.ts <film-id>`. Typical session: `film:init` → `bun film.ts <id>` → read
`films/<id>/screenplay.fountain` → edit `project.json` if something is off → `bun film.ts <id>` again.

## Creating a film

```bash
bun run film:init
```

The wizard asks for the film id, whether you start from an idea or a screenplay (typed, or read from a file), a visual
style (typed, from a file, or from the built-in list), the target length of an idea, and optionally the dialogue
language and the image and video resolution. It writes `films/<id>/` and prints the command to run it.

```bash
bun film.ts <film-id>                  # run the steps; finished ones are cached in project.json
bun film.ts <film-id> --redo=cast      # redo a step and everything built on it
```

By hand: `films/<id>/input/idea.txt` **or** `input/screenplay.txt` (the screenplay wins if both exist), optionally
`input/style.txt` and `config.json`.

## Steps

| # | Step (`--redo=`) | What it does | Built on |
|---|------------------|--------------|----------|
| 1 | `brief`      | Title, dialogue language, logline, genre, tone, setting | – |
| 2 | `outline`    | Idea only: characters (look and voice) and scenes with planned seconds | brief |
| 3 | `screenplay` | Idea: writes the script from the outline. Screenplay: structures it - **every line of dialogue is checked against the source** and asked again if the model reworded one | brief, outline |
| 4 | `cast`       | Characters (aliases = every cue the script uses, look, voice, voice-only for a narrator) and locations; every speaker and slugline must resolve | screenplay |
| 5 | `summary`    | Short summary, for the look design later | screenplay |

`films/<id>/screenplay.fountain` is written on every run: the screenplay in [Fountain](https://fountain.io), readable
in any screenwriting tool. The pipeline works on `project.json` - to change the script, edit it there and run again (the
steps built on it are redone).

Dialogue is never translated or reworded: a screenplay keeps its language, an idea is told in `dialogueLanguage`
(default: the language of the idea). The prompts, descriptions and sluglines are English.

The run also prints a rough running time and clip count (about 2.5 spoken words per second, ~3 s per action) - a guess,
to compare with the target before anything expensive is rendered.

## config.json

All optional:

```json
{"dialogueLanguage": "auto", "targetDuration": 90, "seed": -1, "imageResolution": -1, "videoResolution": -1, "llm": {}}
```

| Field | Values |
|-------|--------|
| `dialogueLanguage` | `"auto"` = the language of the idea, or a code like `"de"`. Ignored for a screenplay |
| `targetDuration`   | seconds an idea is developed for, at least 10; `-1` = as long as the story needs |
| `seed`, `imageResolution`, `videoResolution`, `llm` | as in the music-video [config.json](../README.md#configjson) |

## Design decisions

- **No TTS and no audio references.** The video model speaks the dialogue itself: it is written into the clip prompt as
  `<d>[Language] …</d>` with a speaker id and a voice description per character (`FilmCharacter.voice`).
- **Cast and locations are references**, as in the music-video pipeline: `<Subject N>` defined by `<Picture N>`, see
  [the full-reference guide](minimax-h3-video-prompt-writing-guide.md). Speaker ids `(Sx)` are numbered per clip, in the
  order of the spoken lines.
- The music-video pipeline, its prompts and `lib/project.ts` are not touched - `lib/film/` has its own store, config and prompts.

## What's next

1. Look design and reference pictures (look brief, character and location pictures - reusing `lib/render.ts`'s picture rendering)
2. Coverage: scenes into shots, shots packed into clips of ≤10 s by estimated speaking time
3. Clip requests in the full-reference format with dialogue, and a film workflow without audio inputs
4. Rendering, dialogue check with Whisper, assembling with crossfades, optional score and subtitles
