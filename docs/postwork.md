# Post-work: steps on the finished video

Optional steps for publishing a finished video. Each one is a command of its own. It reads one final video of the project
and writes a new one next to it, with its own ending on the name. Nothing else of the project is touched, nothing is
rendered on ComfyUI, and the video it started from stays as it is. Run again, a step replaces the video it wrote
before. All steps are off until you run them.

| Step | Command | Writes | Issue |
|---|---|---|---|
| The AI marker | `bun run label <id>` | `<name>-labeled.mp4` | #607 |

The steps need nothing but ffmpeg: the marker is ffmpeg's own `overlay` filter.

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

## The settings

Every option of a step can be kept, so the command needs none of them. The later one wins, field by field:

1. the defaults (in the table above)
2. `"postwork"` in the **settings file**: the same for every project, e.g. your own marker
3. `"postwork"` in the project's **`config.json`**: this project
4. the options of the command

```json
{
  "postwork": {
    "label": {"marker": "generated-white50", "mode": "credits", "seconds": 6, "corner": "top-right", "size": 6, "margin": 3}
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

The form opens with what the project has set (the defaults, the settings file and `config.json` together).

## Chaining the steps

Each step starts from the video you name with `--from` (on the page: *From*), so the steps can follow each other in any
order. `my-song-finished-labeled.mp4` is the finished video with the marker on it.
