# Working on the code

For changing FeverSlop TS itself. Using it: the [README](../README.md).

## Layout

| Where | What |
|-------|------|
| `index.ts` | the music-video pipeline: every step in order, from the song to the H3 requests and the render |
| `film.ts`, `lib/film/` | the short-film pipeline ([film.md](film.md)) - separate on purpose, it shares only the LLM client, the settings, the renderer and a few helpers |
| `lib/project.ts` | `project.json`: the cached steps, `dependsOn` (which step is built on which), `--redo` |
| `lib/inputs.ts` | the inputs whose change redoes steps, and which steps a project uses at all (`stepUsed`) |
| `lib/config.ts`, `lib/settings.ts` | `config.json` per project and the machine settings, both checked field by field |
| `lib/prompts.ts`, `lib/shot-planner.ts` | the LLM prompts; `lib/shot-plan.ts` reads the planner's answers |
| `lib/llm.ts` | the LLM client: streaming, JSON schema, repair, `llmMap` for parallel calls |
| `lib/music.ts`, `lib/lyrics.ts` | song analysis, stems, transcript, lyric alignment, the clip timeline |
| `lib/compose.ts` | builds the H3 requests from the plan - deterministic, never cached |
| `lib/render.ts`, `lib/sequenceSheet.ts`, `lib/interpolate.ts` | rendering on ComfyUI: pictures, reference sheets, clips, frame interpolation |
| `lib/provenance.ts`, `lib/render-spec.ts`, `lib/render-state.ts` | what a rendered file was made from, and whether it is stale |
| `lib/assemble.ts`, `lib/timeline-export.ts` | the final video and the editor timelines |
| `lib/casting.ts`, `lib/library.ts`, `lib/asset-import.ts` | `casting.json`, the asset library, import/export |
| `lib/timings.ts`, `lib/stats.ts`, `lib/stats-report.ts`, `lib/stats-view.ts`, `lib/predict.ts` | measured durations, stats aggregation/presentation, the estimates of `--dry-run`/`status` |
| `lib/log.ts` | terminal output, the run log in `logs/`, errors |
| `comfy/` | workflows (`comfy/workflows/`), helpers and the generated node types - [custom-workflows.md](custom-workflows.md) |
| `tools/` | the `bun run …` scripts; `tools/*.py` the audio analysis, run with `uv` |
| `site/` | the documentation site, built from the README and `docs/` by `bun run site:build` |

## Principles

- **The LLM decides what a text means.** No word lists and no regular expressions over LLM text. When the code needs to
  know something about a text, the prompt asks for it in its own field or markup (`{Name}` tokens, a flag); the code
  works with ids, tokens and counts.
- **Nothing tailored to one project.** A fix for one song is a fix for every song.
- **Music and film stay separate.** A change to one pipeline is its own PR; no shared core for both.
- **Cached steps, rebuilt requests.** Every LLM and analysis result is a step in `project.json`; the H3 requests are
  always rebuilt from it, so a hand edit takes effect on the next run.
- **Never overwrite a render.** Rendered files are put away in `old/`, never deleted.

## Adding a step

1. Add its result to the `Project` type and its dependencies to `dependsOn` in `lib/project.ts`. Every step that reads
   it lists it there - that is what makes `--redo` and changed inputs redo the right things.
2. Run it in `index.ts` with `project.step('<name>', '<number> · <TITLE>', async () => …)`. A step that asks once per
   element (a character, a place) keeps each answer with `project.each` (see `lib/partials.ts`), so an interrupted run
   continues.
3. If the step is only used sometimes, say when in `stepUsed` in `lib/inputs.ts` (`bun run status` reads it). If an
   input file or a config field changes it, add it to `projectInputs`.
4. Document it: the [Steps](../README.md#steps) table (the site reads that table), and the table of inputs under
   [Usage](../README.md#usage) when an input redoes it.

A new config field: `lib/config.ts` (type, default, check), the [config.json](../README.md#configjson) table and, if it
changes the plan, `projectInputs`.

## Tests and checks

```bash
bun test              # the unit tests, next to the code as *.test.ts
bun run typecheck     # TypeScript, including the workflows against comfy/nodes.ts
```

The tests cover the parts without servers - parsing, alignment, timeline, composition, fingerprints. Nothing calls an
LLM or ComfyUI; those parts are tried on a real project.

**Golden tests** (`lib/golden.test.ts`, snapshots in `lib/__snapshots__/`) record what the music video sends to ComfyUI
(every clip workflow, node by node), what it runs ffmpeg with (rendering with a stand-in for ComfyUI, joining, finishing,
48 fps), its config and the fingerprints of its clips - and the same for the film where it uses the shared code. The film
pipeline shares the music video's render, workflow and finishing code: a changed snapshot is a changed music video, or
rendered clips of existing projects that turn stale. Never update them (`bun test --update-snapshots`) to make a test
pass - only for a change the PR means and names. The ffmpeg part needs ffmpeg on the PATH and is skipped without it.

## Docs

- `docs/style-examples.md` is generated - edit `lib/styles.ts` and run `bun run styles:doc`.
- `comfy/nodes.ts` is generated by `bun run comfy:types` - never edit it.
- A user-facing change updates the README or the doc it belongs to in the same PR.
