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
2. **Do you already have the song?**
   - Yes → give the path to a `.wav`/`.mp3` file, it's copied to `input/song.wav`
   - No → type a song idea (or read it from a file), plus an optional musical-style hint; the song is generated
     later with the `yue2-song` workflow
3. **Lyrics and/or a story idea** - required with an existing song (at least one of the two); optional when
   generating the song (the lyrics are written from the idea automatically otherwise)
4. **Visual style** (optional) - e.g. "gothic, candlelit, desaturated"
5. **Customize settings?** - No → defaults (clip mode, the workflow's own resolution). Yes → singer mode (none / the
   LLM decides / named characters), language, image/video resolution

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

= pictures (Krea 2) + clips (MiniMax H3) + `<project-id>.mp4`. Needs a reachable ComfyUI server (`bun run setup comfy`).

## 5. Listen to the result

`projects/<id>/<id>.mp4` - done. To test individual steps:

```bash
bun index.ts <id>                                  # just planning, nothing rendered
bun index.ts <id> --render=images                  # pictures only
bun index.ts <id> --render=videos --only=slot-001  # a single clip
```

## Doing it again / differently

- `bun run example --no-render` - create the example project only, start the song yourself later
- `bun index.ts <id> --redo=beats` - regenerate a single step
- Hand-edit files under `projects/<id>/input/`, then just run `bun index.ts <id>` again - changed inputs are
  detected automatically

See also: [../README.md#creating-a-project](../README.md#creating-a-project) for the full field reference.
