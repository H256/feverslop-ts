# Short films (experimental)

`film.ts` turns a **story idea** or a **screenplay** (in any language) into a short-film plan: screenplay, characters
with looks and voices, locations, reference pictures, shots and one MiniMax H3 reference-to-video request per clip. It is a
separate pipeline next to the music-video one (`index.ts`) and shares only the LLM client, the settings, the renderer and a
few helpers with it. Films live in `films/<id>/`, not in `projects/`.

**Status: stages 1-3c of the plan.** The whole way from an idea or a screenplay to a finished film runs: reference pictures and
clips are rendered with ComfyUI (the model speaks the dialogue and makes its own sound) and assembled into `<id>.mp4`. Checking the
dialogue, subtitles and a score are still to come (see [What's next](#whats-next)).

## Quick start

Needs [Bun](https://bun.com) and an LLM server - the same one as the music-video pipeline (`bun run setup llm`, see the
[README](../README.md#setup)). Rendering the pictures also needs a ComfyUI server (`bun run setup comfy`).

| Command | What it does |
|---------|--------------|
| `bun install` | once |
| `bun run setup llm` | once: connect the LLM server |
| `bun run film:init` | create a film: idea or screenplay, style, length, language, resolution |
| `bun run film:replace-character [film-id]` | wizard: swap a character's reference picture for your own (or one that came out wrong) and update its description - see [Replacing a character](#replacing-a-character) |
| `bun film.ts <film-id>` | run all steps; finished steps are cached, an edited input redoes what depends on it |
| `bun film.ts <film-id> --redo=cast` | redo a step and everything built on it (several: `--redo=outline,screenplay`) |
| `bun film.ts <film-id> --render=images` | also render the reference pictures of the characters and locations with ComfyUI |
| `bun film.ts <film-id> --render=videos [--only=clip-005,clip-006]` | render the clips (all, or only some - try one first) |
| `bun film.ts <film-id> --render=videos --only=clip-005 --again` | render the named clips **again with a new seed** (every one is GPU time; `--only` is required): the old version is put away in `old/attempts/`. A clip that goes on from the last frame of one of them is named - it is not rendered again unless you name it too |
| `bun film.ts <film-id> --render=final [--only=clip-005,clip-006]` | assemble `films/<id>/<id>.mp4` from the rendered clips; with `--only` a try-out, `<id>-partial.mp4`. `--render=all` = images, then videos, then the film |
| `bun film.ts <film-id> --llm-model=… --llm-url=… --llm-key=… --comfy=http://a:8188,…` | another LLM / ComfyUI servers for this run only |

`bun run film <film-id>` is the same as `bun film.ts <film-id>`. Typical session: `film:init` → `bun film.ts <id>` → read
`films/<id>/screenplay.fountain` and the clip prompts → edit `project.json` if something is off → `bun film.ts <id>
--render=images`.

## Creating a film

```bash
bun run film:init
```

The wizard asks for the film id, whether you start from an idea or a screenplay (typed, or read from a file), a visual
style (typed, from a file, or from the built-in list), the target length of an idea, and optionally the dialogue
language and the image and video resolution. It writes `films/<id>/` and prints the command to run it.

By hand: `films/<id>/input/idea.txt` **or** `input/screenplay.txt` (the screenplay wins if both exist), optionally
`input/style.txt` and `config.json`. Without `style.txt` the first run has the LLM choose the one style from
[docs/style-examples.md](style-examples.md) that suits the film - genre, tone, setting and audience decide, there is no
draw and no forced variety - and say why; it is written to `input/style.txt`. Edit or replace it and the look is redone.

## Steps

| # | Step (`--redo=`) | What it does | Built on |
|---|------------------|--------------|----------|
| 1 | `brief`      | Title, dialogue language, logline, genre, tone, setting | – |
| 2 | `outline`    | Idea only: characters (look and voice) and scenes with planned seconds | brief |
| 3 | `screenplay` | Idea: writes the script from the outline. Screenplay: structures it - **every line of dialogue is checked against the source** and asked again if the model reworded one | brief, outline |
| 4 | `cast`       | Characters (aliases = every cue the script uses, look, voice, voice-only for a narrator) and locations; every speaker and slugline must resolve. Extras, crowds and ghosts are scene description, not characters | screenplay |
| 5 | `summary`    | Short summary, for the look design | screenplay |
| 6 | `lookBrief`  | The film look - extends `style.txt` | summary |
| 7 | `characterLooks`, `characterDescriptions` | Krea 2 prompt per character who is seen, and the description without the picture's pose and background for the clip prompts | cast, lookBrief |
| 8 | `locationLooks`, `locationDescriptions` | the same for the locations | cast, lookBrief, summary |
| 9 | `coverage`   | Every scene broken into shots (framing, camera, who is in it, action, which dialogue lines). The answer is checked: every line in exactly one shot, in order | screenplay, cast |
| 10 | –           | Shots packed into clips of ≤ ~9.3 s, then the H3 requests - built deterministically, never cached: `output/clips/clip-001.json …`, `output/timeline.json` | coverage |
| 11 | –           | Reference pictures and clips rendered with ComfyUI (only with `--render=images` / `--render=videos`). A clip that starts on the last frame of the one before waits for it, those render one after the other | |
| 12 | –           | The film: every clip cut to exactly its frames and joined, with the sound the model made for it and a 20 ms fade at each cut (only with `--render=final`) | |

Steps 6-8 use the music-video pipeline's look prompts unchanged; the script's own description of a character is passed in
as a fact the picture has to show. The original screenplay is also given to the cast step, because a character list
("ELIAN (30s): …") does not survive the structuring.

`films/<id>/screenplay.fountain` is written on every run: the screenplay in [Fountain](https://fountain.io), readable
in any screenwriting tool. The pipeline works on `project.json` - to change the script, edit it there and run again (the
steps built on it are redone).

Dialogue is never translated or reworded: a screenplay keeps its language, an idea is told in `dialogueLanguage`
(default: the language of the idea). The prompts, descriptions and sluglines are English.

The run prints a rough running time and clip count (about 2.5 spoken words per second, ~3 s per action) - a guess, to
compare with the target before anything expensive is rendered.

## Clips and prompts

A clip is at most ~9.3 s (the video model renders 5 + 17·k frames) and never spans two scenes; a shot is never split, so
no line of dialogue is cut in two. A shot lasts at least the time to speak its lines (estimated).

The request of a clip is the [full-reference format](minimax-h3-video-prompt-writing-guide.md): the location is
`<Subject 1>`, the characters in its shots are `<Subject 2>` and up, each defined by the `<Picture N>` with the same
number. Dialogue is written into the shot as `<Subject 2> (S1) says in a young man's low, hoarse voice, <d>[German] …</d>`;
an off-screen speaker and a voice-over (lips closed) have their own forms, and everyone else in the frame keeps their
mouth closed. Speaker ids are numbered per clip, in the order of the spoken lines. The scene's ambience goes into
`overall_soundscape`, `non_diegetic_music` is `N/A`.

**Staging.** The shot planning writes for every scene the fixed arrangement of the people - where they are, in what posture, what they wear and hold - and every clip of the scene carries it in its prompt; the shots must keep to it. Without it, every clip draws the posture again (a man lying in the crater, sitting at its rim, lying again, with the uniform open, closed ...). **No speech without a line:** every shot without a line of dialogue says that nobody speaks, and the soundscape excludes speech apart from the dialogue - the video model otherwise makes up speech for people it shows. A clip with dialogue keeps all frames the model rendered, the last word of a line often falls behind the planned end, and the time planned for a line is generous (the model starts about a second into the shot).

**Fewer, better shots.** The shot planner is told that a shot shows something new (never a second shot of what an earlier one shows; atmosphere is one shot) and is given the most shots a scene has material for (one per block of action of the screenplay, one per two lines of dialogue - counted from its structure, not from its text, which differs between languages). It also reads the script of every scene and says whether anyone is in it (`people` - a character, a creature, people said in general words) and whether the script itself has voices in it that are not numbered lines (`voices` - whispers, a chant, a spell). A scene that is only a place becomes one shot without people; where the script has voices, they stay, wordless and indistinct; everywhere else every shot without a line says that nobody speaks. Nothing here is guessed from word lists - understanding is the language model's job, and what a finished clip says is for you to listen to (Whisper is too brittle to build on, and too slow without a GPU). The few checks in code only count (too many shots: asked again once, then kept with a warning). `output/shotlist.md` is the plan to read: scene by scene the staging, the shots with who is in them, what happens and what is said, and the clip of each shot. Duplicate shots that say the same in other words are best seen there.

A clip whose first shot goes on in the same take as the one before starts on that clip's last frame (`startsFrom`, `<Picture N>`
as its first frame) - `continuity` in the config.

## Replacing a character

A reference picture that came out wrong, or a character you have drawn yourself or carry over from another project:

```bash
bun run film:replace-character          # asks which film, which character, and for the new picture
```

The wizard keeps the old picture in `films/<id>/old/`, saves yours as the character's picture (any image format), clears what was built from the old
one (with `sequenceSheets`: the sheet's video and frames), lets a vision-capable LLM describe the new picture for the clip prompts (or you type
it), names the clips that were already rendered with the old picture - they are not touched, delete the ones you want redone - and offers to
render the new reference sheet. It is the film counterpart of `bun run replace-character`.

## config.json

All optional:

```json
{"dialogueLanguage": "auto", "targetDuration": 90, "seed": -1, "imageResolution": -1, "videoResolution": -1, "sequenceSheets": true, "continuity": "auto", "llm": {}}
```

| Field | Values |
|-------|--------|
| `dialogueLanguage` | `"auto"` = the language of the idea, or a code like `"de"`. Ignored for a screenplay |
| `targetDuration`   | seconds of film, at least 10; `-1` = as long as the story needs. An idea is developed for it, and the shots of every scene are planned to it (each scene gets its share, by the length of its script). A **screenplay** is only planned to a length when this is written in `config.json` - without it the shot planning decides freely, and a script of ~140 s easily becomes 240 s |
| `sequenceSheets`   | `true` (default) = every picture is a multi-angle reference sheet (a short turnaround video, sampled and composited), `false` = one plain picture each - much cheaper |
| `continuity`       | `"auto"` (default) = clips go on from the last frame of the one before where the shot planning marked a take that goes on, `"scene"` = every clip of a scene but its first does (people keep their posture and clothes from clip to clip, but the clips of a scene render one after the other), `"never"` = every clip is its own cut |
| `seed`, `imageResolution`, `videoResolution`, `llm` | as in the music-video [config.json](../README.md#configjson) |

## Design decisions

- **No TTS and no audio references.** The video model speaks the dialogue itself: it is written into the clip prompt as
  `<d>[Language] …</d>` with a speaker id and a voice description per character (`FilmCharacter.voice`).
- **Cast and locations are references**, as in the music-video pipeline.
- **The clips have their own workflow**, `comfy/workflows/h3-ref2video-film.ts`: pictures only. Like ComfyUI's own MiniMax H3 template it samples the empty video+audio latent that `MiniMaxH3ReferenceToVideo` returns and decodes it twice (video VAE, audio VAE) - the sound, speech included, comes from the model.
- The music-video pipeline, its prompts and `lib/project.ts` are not touched - `lib/film/` has its own store, config,
  prompts and clip builder. The look prompts (`lookBriefPrompt`, `characterLookPrompt`, ...) and the `Renderer` are imported.

## What's next

1. States of a character as reference variants (wounded, uniform open)
2. Subtitles (the translations that are dropped when parsing could become them), an optional score, level matching between clips
3. A timeline export for an editor, a gallery, tests for the pure parts
