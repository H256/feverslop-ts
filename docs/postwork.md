# Post-work: steps on the finished video

Optional steps for publishing a finished video. Each one is a command of its own. It reads one final video of the project
and writes a new one next to it, with its own ending on the name. Nothing else of the project is touched, nothing is
rendered on ComfyUI, and the video it started from stays as it is. Run again, a step replaces the video it wrote
before. All steps are off until you run them.

| Step | Command | Writes | Issue |
|---|---|---|---|
| The AI marker | `bun run label <id>` | `<name>-labeled.mp4` | #607 |
| A title card and credits | `bun run credits <id>` | `<name>-credits.mp4` | #609 |
| An intro | `bun run intro <id>` | `<name>-intro.mp4` | #608 |
| The YouTube text | `bun run description <id> --from=<video>` | `<name>.youtube.txt`, `.youtube.json` | #805 |

The steps need nothing but ffmpeg: the marker is ffmpeg's own `overlay` filter, the intro its `concat`, `xfade` and
`acrossfade`, the credits its `drawtext` (with libfreetype, which the usual builds have) in a font of the repo.

## Why: the AI Act

From 2 August 2026, Article 50(4) of the EU AI Act asks whoever publishes a **deep fake** to disclose that it was made or
changed by AI. A deep fake is AI-generated or manipulated image, audio or video that resembles real persons, places or
events. A clip that shows a real face, for example through a LoRA of your own face and a reference-to-video render, is one.

The Commission's Code of Practice on marking and labelling AI-generated content (final version of 10 June 2026) says how:

- An icon or label "where no intervening overlay elements exist (e.g., in the top right corner of an image or video deep
  fake)", embedded in the content, so it stays with the video when it is shared or downloaded.
- For a deep fake video in general: "at the beginning of the video as well as, where possible, at regular intervals".
  Showing it throughout is encouraged.
- For an **evidently artistic, creative, satirical or fictional work** (Commitment 3), the disclosure must "not hamper the
  display or enjoyment of the work". It is enough "at the latest at the time of first exposure", for example in the
  "beginning/ end credits", and visible "for a sufficient duration to be easily noticed". A music video or a short film
  is such a work.

The code is voluntary, and so are its icons; the duty to disclose is not. This is a convenience, not legal advice: whether
a video is a deep fake, and what the platform you publish on asks for besides, is yours to judge.

Not covered here: the **machine-readable** marking of Article 50(2) (signed metadata such as C2PA, an invisible watermark).
That is the duty of the provider of the AI system. ffmpeg can only write unsigned tags; a signed manifest would need an
external tool such as `c2patool` and a signing certificate.

Sources: [the code](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content),
[the EU icons](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content).

## The AI marker: `bun run label`

```bash
bun run label my-song                                   # the defaults: the EU "AI GENERATED" icon, top right, the first 5 s
bun run label my-song --mode=interval --interval=60     # at the start and again every minute, 5 s each time
bun run label my-song --mode=always --marker=basic-white50 --corner=bottom-right
bun run label my-song --marker=input/my-label.png       # a PNG of your own
bun run label my-film --film --from=my-film-finished.mp4
bun run label my-song --dry-run                         # what it would do, and the ffmpeg filter
```

| Option | Default | |
|---|---|---|
| `--from=<file>` | `<id>-finished.mp4`, else `<id>.mp4` | the video to start from: the file name of any video in the project folder |
| `--marker=` | `generated-white50` | a preset (below) or the path of a PNG, absolute or relative to the project |
| `--mode=` | `credits` | `credits`: only at the start. `interval`: at the start and every `--interval` seconds. `always`: the whole time |
| `--seconds=` | `5` | how long it is shown at a time |
| `--interval=` | `60` | with `interval`: seconds from one showing to the next |
| `--corner=` | `top-right` | `top-right`, `top-left`, `bottom-right`, `bottom-left` |
| `--size=` | `6` | the marker's height in % of the video's height |
| `--margin=` | `3` | its distance from the edges, in % of the video's height |
| `--save` | | keep the options given for this project (`config.json`) |
| `--save-default` | | keep them for every project (the settings file) |

The sound and any subtitle track are copied as they are; the picture is encoded once more, at the quality of the final
video.

**The presets** are the EU icons, in `assets/eu-ai-icons/` (free to use, see the README there):
`generated` ("AI GENERATED", for content fully made by AI), `modified` ("AI MODIFIED", human-made content changed by AI)
and `basic` ("AI"), each as `-white`, `-black`, `-white50` or `-black50` (50 % transparent). A PNG of your own keeps its
transparency. An SVG would need an ffmpeg built with librsvg, so convert it to a PNG first.

## A title card and credits: `bun run credits`

A title card before the video - the title, who made it, the disclosure, the marker if you like - and credits that scroll
up after it: the title again, lines of your own, and **what it was made with**.

```bash
bun run credits my-song --artist="Klemens" --save-default        # your name once, for every project
bun run credits my-song --title="Bone Saws Dirge" --line="Thanks to the band" --line="youtube.com/@me" --save
bun run credits my-film --film --director="K. W." --marker=generated-white
bun run credits my-song --no-opening --sound=input/outro.mp3      # only the credits, with music under them
bun run credits my-song --dry-run                                 # the credits as text, nothing written
```

What it was made with is **collected by code, never written by a model** - a fact that is not known is left out:

- **Language model**: the models the plan's calls went to, as measured (the timings file of `bun run stats`); for a
  project from before the measurements, the model of the settings.
- **Models**, per kind of render (video, pictures, reference sheets, song, frame interpolation, upscaling): what the
  graphs of its renders loaded - diffusion model, checkpoint, LoRAs, text encoder, not the VAE. For a render that was not
  measured, the workflow its file's sidecar names and the model names that workflow has in it.
- **Hardware**: the graphics cards its renders ran on, as measured, with their memory; then your own words
  (`--hardware="LLM: Strix Halo, 128 GB"`), e.g. for the machine the language model runs on.
- **Made with**: FeverSlop TS and its version, ComfyUI, ffmpeg.

The run prints the credits line by line before it draws them; `--dry-run` only prints them.

| Option | Default | |
|---|---|---|
| `--from=<file>` | `<id>-finished.mp4`, else `<id>.mp4` | the video |
| `--title=` | a film's title, a music video's id | |
| `--artist=` / `--director=` | none | a music video: "by …", a film: "Directed by …" (the words before it: `artistLabel`, `directorLabel` in the settings) |
| `--disclosure=` | `Contains AI-generated content` | on the title card and at the end of the credits; `--disclosure=` empty: none |
| `--marker=` | none | an AI marker on the title card: a preset or a PNG, as `bun run label` takes it |
| `--line=TEXT` | none | a line of your own in the credits; repeat it for more, `--no-lines` for none |
| `--hardware=` | none | your own words after the graphics cards |
| `--no-facts` | | leave out what it was made with |
| `--no-opening` / `--no-end` | | only the credits / only the title card |
| `--opening-seconds=` | `4` | |
| `--end-seconds=` | `0` | 0: about 1.5 s per line, at least 8 |
| `--sound=<path>` | silence | a sound file under the credits, faded out at their end |
| `--font=<path>` | Lato (`assets/fonts/`) | a .ttf or .otf of your own |
| `--save` / `--save-default` | | keep the options given for this project / for every project |

The cards have the size and frame rate of the video, black, white text, faded in and out. The sound of the video is
untouched; silence runs under the title card. Subtitle tracks are kept and moved by the length of the title card.

## An intro: `bun run intro`

A clip of your own in front of the video: a logo, a channel ident, a title card.

```bash
bun run intro my-song                                   # input/intro.mp4 of the project, a hard cut
bun run intro my-song --file=D:/videos/channel.mp4 --fade=0.5 --save-default   # one intro for every project, faded in
bun run intro my-song --from=my-song-finished-labeled.mp4
```

| Option | Default | |
|---|---|---|
| `--from=<file>` | `<id>-finished.mp4`, else `<id>.mp4` | the video to put it in front of |
| `--file=<path>` | `input/intro.mp4` (`.mov`, `.mkv`, `.webm`) of the project | the intro, absolute or relative to the project |
| `--fade=` | `0` | seconds the intro fades into the video, picture and sound; 0 is a hard cut |
| `--save` / `--save-default` | | keep the options given for this project / for every project |

The intro takes the size, the frame rate and the pixel shape of the video. Another aspect ratio gets black bars; it is
never stretched or cropped. An intro without sound gets silence; the sound of an intro is cut or filled to the length of
its picture, so the video after it stays in sync. A video without sound stays without. Subtitle tracks of the video are
kept and moved by the length of the intro. The picture and the sound are encoded once more (the sound as AAC 320k).

## The YouTube text: `bun run description`

The description for publishing a finished video on YouTube, as a text file to paste into YouTube Studio. Nothing is
uploaded, and no video is written.

```bash
bun run description my-song                                              # lists the finished videos to choose from
bun run description my-song --from=my-song-48fps-finished-labeled-intro.mp4
bun run description my-song --from=my-song-finished.mp4 --new-story      # let the model write the teaser again
bun run description my-song --from=my-song.mp4 --line="youtube.com/@me" --tag=AIgenerated --tag=feverslop --save-default
bun run description my-song --from=my-song.mp4 --dry-run                 # the text, nothing written, no model asked
```

**The video is yours to choose**: any finished one of the project (with or without the marker, 24 or 48 fps, with or
without intro and credits). With only one there is nothing to choose; with more, the command lists them and asks for
`--from`. The text follows the video: what it went through (refinish, frame interpolation, grade, marker, credits, intro)
is read from its name, its size, frame rate and length from the file. Each video gets its own `<name>.youtube.txt` (the
description) and `<name>.youtube.json` (title, description, tags, the teaser) next to it.

What it says, block by block:

1. **A teaser of the story**, two to four sentences, written by the language model from the project's summary (a film:
   its logline and summary). The only part a model writes. Run again, the teaser of the earlier run stays, so other tags
   do not change it; `--new-story` asks for a new one, `--no-story` leaves it out. When the model fails, the text goes
   without it.
2. **That it is AI-generated**: every picture and every movement - the song as well, when the project rendered it.
3. **What FeverSlop TS is**, and the fever-dream AI slop behind the name. Your own words instead: `"about"` in the
   settings (line breaks allowed; one line per paragraph, YouTube wraps it).
4. **How it was made**, collected by code as for the credits, whatever is not known left out: the graphics cards with
   their memory (and `--hardware=`), the language model, the models per kind of render (no interpolation model for a 24
   fps video), the **measured time per phase** - planning, pictures and reference sheets, song, clips, frame
   interpolation - and a total, failed and retried attempts said apart. That is the sum of the measured job times,
   re-renders included, not the time that passed: jobs on several servers overlap. Then the video itself and the
   software. `--no-facts` leaves the block out.
5. **Lines of your own** (`--line=`, a link, thanks) and the **hashtags** (`--tag=`, default `#AIgenerated #feverslop
   #AIvideo`).

The title is the one of the credits (`--title` there), else a film's own, else the heading of a music video's story.
YouTube's limits (title 100, description 5000 characters) are checked and said; nothing is cut.

**The disclosure on YouTube**: the text is no substitute for YouTube's own *Altered or synthetic content* setting on
upload. Set it in YouTube Studio; the run reminds you.

| Option | Default | |
|---|---|---|
| `--from=<file>` | the only finished video | the video you publish |
| `--no-story` / `--new-story` | | no teaser / a new one instead of the earlier |
| `--no-facts` | | leave out how it was made |
| `--hardware=` | none | your own words after the graphics cards |
| `--line=TEXT` | none | a line of your own at the end; repeat it for more, `--no-lines` for none |
| `--tag=TAG` | `AIgenerated`, `feverslop`, `AIvideo` | a hashtag; repeat it for more, `--no-tags` for none |
| `--save` / `--save-default` | | keep the options given for this project / for every project |

## The settings

Every option of a step can be kept, so the command needs none of them. The later one wins, field by field:

1. the defaults (in the table above)
2. `"postwork"` in the **settings file**: the same for every project, e.g. your own marker
3. `"postwork"` in the project's **`config.json`**: this project
4. the options of the command

```json
{
  "postwork": {
    "label": {"marker": "generated-white50", "mode": "credits", "seconds": 6, "corner": "top-right", "size": 6, "margin": 3},
    "intro": {"file": "D:/videos/channel-intro.mp4", "fade": 0.5},
    "credits": {"artist": "Klemens", "hardware": "LLM: Strix Halo, 128 GB", "extra": ["youtube.com/@me"], "marker": "generated-white"},
    "description": {"extra": ["youtube.com/@me"], "tags": ["AIgenerated", "feverslop"], "about": "My own words on the program."}
  }
}
```

`--save` writes the options given into the project's `config.json`, `--save-default` into the settings file (see
`bun run setup show` for where it is). A wrong value is refused with what it should be, by the command and by the plan
run that reads `config.json`. Nothing is capped.

## In the workspace

Under the timeline, next to *Refinish*, once there is a final video:

- **AI marker** asks for the video to start from (every final video of the project, the finished one first), the marker
  (an EU icon, or the path of a PNG of your own), when, where and how large, and whether to keep these settings for the
  project. It then starts `bun run label` with them, as in the terminal; the new video appears among the videos of the
  timeline, as *… + AI label*.
- **Intro** asks for the video to start from, the intro (empty: `input/intro.mp4` of the project, the field says when
  there is one) and the fade. It starts `bun run intro`; the new video is listed as *… + intro*.

- **Credits** asks for the video, whether a title card, credits or both, the title, the artist (a film: who directed
  it), the disclosure, a marker on the title card, the lines of your own (one per line), whether to say what it was made
  with, your words on the hardware, a sound under the credits and the lengths. It starts `bun run credits`; the run
  shows the credits line by line, the new video is listed as *… + credits*.

- **YouTube text** asks for the video you publish (none is chosen for you), whether a teaser and a new one, whether to
  say how it was made, your words on the hardware, your lines and the hashtags. It starts `bun run description`; the run
  shows the whole text, the file is next to the video.

All forms can keep their settings for this project (`config.json`) or for every project (the settings file).

The form opens with what the project has set (the defaults, the settings file and `config.json` together).

## Chaining the steps

Each step starts from the video you name with `--from` (on the page: *From*), so the steps can follow each other in any
order. `my-song-finished-labeled.mp4` is the finished video with the marker on it.

The order matters for what is where: **marker, credits, intro** - the marker is then only on the video, the title card
and the credits are around it, and the intro comes first of all: `my-song-finished-labeled-credits-intro.mp4`. With the
marker first it starts with the video, not on the intro. The other way round, the marker sits on the intro too, and in `interval` mode its times count from the
start of the intro.
