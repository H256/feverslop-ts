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
| `editor.ts`, `lib/editor/` | the workspace in the browser: `project.ts` reads a music video or a film into one shape, `references.ts` and `library.ts` the pictures, library and casting, `runs.ts` starts the CLI, `servers.ts` asks the ComfyUI servers how busy they are, `server.ts` serves it all, the page itself is the Vue client in `client/`, built into `lib/editor/public` (#152, #554) |
| `lib/retake.ts`, `lib/archive.ts` | a part of a clip rendered again; versions of clips and pictures, put away and put back |
| `lib/log.ts` | terminal output, the run log in `logs/`, errors |
| `comfy/` | workflows (`comfy/workflows/`), helpers and the generated node types - [custom-workflows.md](custom-workflows.md) |
| `tools/` | the `bun run …` scripts; `tools/*.py` the audio analysis, run with `uv` |

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

### Changing a cached step's shape

When a `project.json` step result changes shape, increment `PROJECT_FORMAT_VERSION` and add the affected root step names
to that version in `PROJECT_FORMAT_REDO` (`lib/project.ts`). Loading an older project then names those cached roots and
their dependents in a `--redo` command. Keep compatibility adapters only when old data must remain usable before that
redo; the format registry records the migration instead of adding another silent branch at each read site.

## Tests and checks

The Checks workflow runs the backend tests and typecheck on pushes and pull requests. Release publication depends on those
checks, so create version tags only from green builds.

### Workspace startup without a configured machine

```bash
bun test ./lib/editor/startup.test.ts
```

This starts the real editor CLI from an empty temporary working directory, with a missing settings file and inherited
`FEVERSLOP_*`/`COMFY` overrides removed. It checks help for the music, film and editor entry points, missing-project
errors, HTML delivery, empty project/library APIs and an unavailable render server. The latter is a local HTTP stand-in;
the check never needs an LLM or GPU. Child processes and temporary data are cleaned up. No frontend build is needed.

To also verify that no ignored files or generated ComfyUI types are required, use a fresh clone (or extract `git archive
HEAD` into a new directory), then run:

```bash
bun install --frozen-lockfile
bun test ./lib/editor/startup.test.ts
bun run typecheck
```

Installation needs access to the package registry or a populated package cache. These are process/HTTP smoke tests:
they do **not** execute the page's JavaScript or verify browser layout, navigation, playback or editing. Before a frontend
refactor, additionally check the overview and empty library in a browser, then use disposable music/film projects for
navigation, unsaved edits, timeline seeking, clip transitions and render-progress checks. Do not start paid generation
or overwrite real project data merely to test startup.

### Existing checks

```bash
bun run test          # backend unit tests; browser tests use their own runner
bun run typecheck     # TypeScript, including the workflows against comfy/nodes.ts
```

The tests cover the parts without servers - parsing, alignment, timeline, composition, fingerprints. Nothing calls an
LLM or ComfyUI; those parts are tried on a real project. They run on a fresh clone too: without the generated
`comfy/nodes.ts` the workflows are built with `comfy/nodes-fallback.ts`, and `bun run typecheck` doesn't check them
against a server. A new node in a workflow goes into that list as well - `comfy/nodes-fallback.test.ts` says so.

**Golden tests** (`lib/golden.test.ts`, snapshots in `lib/__snapshots__/`) record what the music video sends to ComfyUI
(every clip workflow, node by node), what it runs ffmpeg with (rendering with a stand-in for ComfyUI, joining, finishing,
48 fps), its config and the fingerprints of its clips - and the same for the film where it uses the shared code. The film
pipeline shares the music video's render, workflow and finishing code: a changed snapshot is a changed music video, or
rendered clips of existing projects that turn stale. Never update them (`bun test --update-snapshots`) to make a test
pass - only for a change the PR means and names. The ffmpeg part needs ffmpeg on the PATH and is skipped without it.

### Lint and format

`bun run lint` checks the CLI and the client with ESLint (`eslint.config.js`, type-aware: `typescript-eslint` recommendedTypeChecked, `eslint-plugin-vue`); `bun run lint:fix` fixes what it can. `bun run format` formats with Prettier (`.prettierrc.json`: 4 spaces, 2 in `client/`, no semicolons, single quotes, 160 columns), `bun run format:check` only says what it would change. The Checks workflow runs `lint` and `format:check` on every push and pull request, next to the tests and the typecheck - and, as a job of its own, the client's `client:check`, `client:test` and `test:workspace`. The Playwright run (`bun run client:e2e`) needs a browser installed and is run by hand before a change to the page. Rules that find real bugs here are errors - `no-floating-promises` (a forgotten `await`), `no-misused-promises`, `switch-exhaustiveness-check`; `any` from JSON and ComfyUI answers is a warning for now.

## Docs

The workspace page is the Vue client in `client/`, with dependencies, typechecks and build output of its own.
`bun run editor` builds it when it is missing or its sources changed; the pipeline commands never need it.
See [client development](../client/README.md) for the build, the tests and the structure.

- `docs/style-examples.md` is generated - edit `lib/styles.ts` and run `bun run styles:doc`.
- `comfy/nodes.ts` is generated by `bun run comfy:types` - never edit it.
- A user-facing change updates the README or the doc it belongs to in the same PR.
