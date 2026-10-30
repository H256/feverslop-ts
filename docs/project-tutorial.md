# Tutorial: creating a new project

Two commands, in the same interactive style as `bun run setup` (see [../README.md#setup](../README.md#setup)).

**Quick start** - just want to see it work?

```bash
bun run example
```

Picks one of 10 built-in ideas at random, creates a project and generates a 1-minute song right away. Skip ahead to
[step 5](#5-listen-to-the-result).

**Your own project** - want to make your own song/story?

```bash
bun run init
```

Keep reading below.

## 1. Start `bun run init`

Run it in the project directory:

```bash
bun run init
```

The wizard asks, in order:

1. **Project id** - the directory name, e.g. `rusty-crown-legend`
2. **The song**
   - an audio file → give the path to a `.wav`/`.mp3`/`.flac` file, it's copied to `input/` as `song.wav`/`song.mp3`/`song.flac`
   - generate it from a song idea → type the idea (or read it from a file); the LLM writes the lyrics
   - generate it from your own lyrics → type them (or read them from a file); they are set to music as they are

   Both generated kinds get an optional musical-style hint; the song is generated later with the `yue2-song` workflow
3. **Language of the lyrics** - an ISO 639-1 code (`lyricsLanguage`, default `en`): the language a generated
   song is written and sung in, and the one the lyrics are aligned in
4. **Who sings** - leave it open, a woman, a man or a duet (`singerVoice` in `config.json`). A generated song is
   sung in that voice, and the story casts its singers to match it
5. **Lyrics and/or a story idea** - required with an existing song (at least one of the two); with a generated song
   only a story idea, optional
6. **Who is seen singing** - only with lyrics (or an idea that writes them): nobody (clip mode), the LLM picks the
   singers, or named characters (`singers`). With a voice given, "the LLM picks" is the default; with a duet, named
   singers are exactly two
7. **Visual style** (optional) - typed, from a file or picked from the [built-in list](style-examples.md); "← back" in
   the list returns to the level above; a picked style is shown in full and taken only on "Take it"
8. **Target song length** - only when the song is generated; empty = the workflow's own default
9. **Aspect ratio of the video** - 16:9 (default), 9:16, 2:1, 2:3 or another one (`videoAspect`)
10. **Render settings** - *Defaults*; *Quick test* (`sequenceSheets: false`, `videoResolution: 0.5`, a 60 s song when
    it is generated and no length was given); *Quality* (`h3-ref2video-2pass`, 2 MP); *Custom* → image workflow
    (`kroma-image`, `krea2-image`), video workflow (`h3-ref2video`, `-full`, `-2pass`, `-cpu-clip`), image/video
    resolution, and `continuity`: never (default), where the story marks one unbroken take, or always - a continuing
    clip starts on the last frame of the one before, read [Continuous scenes](../README.md#continuous-scenes) first.
    With continuity on, `contextFrames`: the clip starts on the last frame (default), or on the last 22 or 39 frames of
    the clip before, so the movement goes on and not only the pose
11. **Summary** - all answers at a glance: *Write* it, *Change* one of them (the questions that depend on it are asked
    again too - a new song source asks the lyrics/story and the singers again), or *Cancel*
12. **Start it now?** - *Only generate the song now* (a generated song only, preselected - listen to it before the long
    render), *Start the whole run now*, or *Not now*. The command is printed in any case

For any multi-line text (lyrics, story, idea) the wizard asks: *type it now* (an empty line ends it) or *read from a
file*.

## 2. Check the result

Your project now lives under `projects/<id>/`, and the wizard prints the matching command, e.g.:

```bash
bun index.ts rusty-crown-legend --render=song,images,videos,final
```

## 3. Generate the song (only if you didn't have one)

```bash
bun index.ts <id> --render=song
```

Writes `input/lyrics.txt` + `input/song.wav`. Listen to it under `projects/<id>/input/` before running the rest.

## 4. Render everything

```bash
bun index.ts <id> --render=all
```

= reference pictures (`kroma-image`) + clips (MiniMax H3) + `<project-id>.mp4`. Needs a reachable ComfyUI server (`bun run setup comfy`).

## 5. Listen to the result

`projects/<id>/<id>.mp4` - done. To test individual steps:

```bash
bun index.ts <id>                                  # just planning, nothing rendered
bun index.ts <id> --render=images                  # pictures only
bun index.ts <id> --render=videos --only=slot-001  # a single clip
```

## 6. Look before you render

Rendering is the expensive part - these commands show what you are about to pay for:

```bash
bun run status <id>                              # steps done or redone next, renders missing or stale, the next command
bun index.ts <id> --render=videos --dry-run      # what this run would redo and render, with a time estimate
bun index.ts <id> --review                       # stop after story, cast, look and beats: accept, edit in $EDITOR, redo
bun run inspect <id> slot-007                    # one clip: its beat and shots, pictures, audio, render state, prompt
bun index.ts <id> --gallery                      # gallery.html: cast, storyboard, videos at a glance
```

A good order for a new project: plan with `--review`, then `--render=images` and check the pictures in the gallery,
then `--render=videos --only=slot-001` for one clip, then the rest. More: [recipes.md](recipes.md).

## Doing it again / differently

- `bun run example --no-render` - create the example project only, start the song yourself later
- `bun index.ts <id> --redo=beats` - regenerate a single step
- Hand-edit files under `projects/<id>/input/`, then just run `bun index.ts <id>` again - changed inputs are
  detected automatically

See also: [../README.md#creating-a-project](../README.md#creating-a-project) for the full field reference.
