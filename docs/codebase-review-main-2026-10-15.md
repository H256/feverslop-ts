# Review of main: story creation and execution

Date: October 15, 2026 · Commit `fec3f59eb6117ef90d8f5d9665833921f658ac65`.

## Assessment and scope

The most significant problems occur between pipeline stages: recalculating a plan does not reliably ensure that the rendered or assembled media belong to that plan. There are also gaps in source fidelity, duration limits, and character resolution. Adding more prompt rules alone will not solve these problems; several violated rules can be checked deterministically.

The review covered both CLI pipelines, `index.ts` and `film.ts`, their stores, screenplay/shot conversion, the music timeline, request composition, ComfyUI execution, and final assembly. Configuration, workflows, and tests were examined as supporting evidence. `comfy/nodes.ts` was excluded from substantive review. Tests and type checking may load it as an existing import dependency; no findings are made about that generated file.

Result: **13 findings: 4 P1 and 9 P2**. Here, P1 means defects that significantly affect production runs or the reliability of their content; P2 means conditional correctness or robustness defects. This does not imply that any particular existing film exhibits every issue described.

Validation:

- `bun test`: **114 passed, 0 failed**, 302 assertions across eight test files.
- `bun run typecheck`: **no type errors**.
- Ten small local checks in two groups: dialogue loss, ambiguous aliases, film duration limits, reference overflow, music duration limits, job resumption, existing images, render hashes, cache dependencies, and competing store snapshots.
- Two additional boundary checks: a synthetic FFmpeg clip and a local HTTP/SSE test server.
- No real LLM, ComfyUI, or GPU jobs were submitted. This review does not provide an end-to-end quality assessment of generated images, speech, or acting.

Reproductions were run outside the repository under `%TEMP%/storymaker-review-main-20261015/`. Production code and existing project files were not modified.

## Confirmed findings

### R1 · P1 · Resumed render jobs are not bound to the current request

**Evidence:** `lib/render.ts:414–425`, `lib/render.ts:448–475`, `lib/film/render.ts:61–75`.

`<target>.pending.json` stores the job ID, server, output node, and metadata, but no request fingerprint. `resumeOrQueue()` accepts any job that is still running, queued, or completed. In that case, `prepare()` is never called. Changes to the prompt, workflow, seed, or reference images since the interruption are ignored.

**Reproduction:** A saved job named `old-plan` with server status `completed` was resumed; the preparation counter for the new plan remained **0**.

**Impact:** After a plan change, an interrupted run can download the old result. The film renderer makes this particularly problematic: after downloading, it writes `promptHash(clip)` from the **current** request into the sidecar. The old media therefore receive the new plan's provenance marker, preventing the subsequent stale-result check from detecting the mismatch.

**Recommendation:** Compute a canonical render request before resuming and compare its fingerprint with the saved request. Metadata must describe the request actually executed. When inputs change, retain the old job as a separate version and submit a new request.

### R2 · P1 · Invalidating the planning cache does not invalidate existing media

**Evidence:** `lib/render.ts:158–160`, `lib/render.ts:186–188`, `lib/render.ts:289–304`, `lib/assemble.ts:69–82`.

Reference images and sequence sheets are skipped solely because their files exist. Music-video clips behave the same way. Their sidecars contain no verifiable fingerprint of the prompt and source assets; `assembleFinal()` checks existence, length, and audio where applicable, but not whether a clip belongs to the current plan.

**Reproduction:** `renderPicture()` was called with an entirely different prompt for an existing image containing `old bytes`. It reported `Exists`; the file remained unchanged.

**Impact:** `--redo=story` or a change to `style.txt` can produce new story, look, and shot data while old images and videos remain in use. If slot IDs shift, a music video can use material from the previous story or previous time interval. The film pipeline at least has a prompt check, but it still does not detect outdated reference images.

Preserving user-provided assets is a legitimate product requirement. It does not justify treating those assets as compatible with a new plan without checking their version or explicitly pinning them.

**Recommendation:** Distinguish explicitly pinned user assets from generated assets. Use a manifest to classify generated files as current or stale; archive stale versions or block execution with a concrete list. Automatic deletion is unnecessary.

### R3 · P1 · Imported screenplays can lose dialogue without triggering source validation

**Evidence:** `lib/film/screenplay.ts:52–56`, `film.ts:140–156`.

`missingDialogue()` only checks whether each **output** dialogue line appears somewhere in the normalized source. The reverse check is absent: lines omitted entirely by the model are invisible. Speaker assignment, scene assignment, order, and occurrence counts are not compared with the source either. Removing all word boundaries can also make substrings count as matches.

**Reproduction:** A source containing `A: Hello.` and `B: Do not leave.`, with a structured screenplay containing only `A: Hello.`, produces **`[]`**: no offending lines.

Even detected rewrites do not stop the run after the second attempt; the pipeline only warns and saves the result.

**Impact:** The pipeline can treat an incomplete or rewritten screenplay as a faithful import and execute expensive downstream stages from it.

**Recommendation:** Use deterministic import for supported formats, such as Fountain. For free-form text, maintain an explicit source mapping with segment IDs and bidirectional coverage. If validation fails, export a reviewable import draft and prevent rendering. At minimum, rename the existing check to accurately describe its limited purpose: detecting additional or changed output lines.

### R4 · P1 · A late first downbeat produces music clips far above the limit

**Evidence:** `lib/music.ts:107–129`, `lib/music.ts:163–167`.

The time-based fallback only runs when a section contains no downbeats at all. If a section has a long intro followed by a few late downbeats, the lead-in is added to the first bar group. The loop can only reduce `firstSize` to 1; any remaining overrun is neither split nor rejected.

**Reproduction:** 20 seconds of music at 120 BPM, one section covering 0–20 seconds, and downbeats at 15, 17, and 19 seconds. With a clip limit of **9.292 seconds**, `buildTimeline()` produces one slot covering **0–20 seconds**.

**Impact:** An apparently valid plan requests a clip that is too long for this pipeline. A free-form intro with little percussion is a realistic input, not an exotic edge case.

**Recommendation:** Handle lead-ins and tails separately, then validate every interval on the frame grid. If no musical cut point is available within the limit, add a time-based cut. Enforce these invariants: every clip has positive duration, every clip fits the supported limit, and the clips cover the song without gaps.

### R5 · P2 · Film planning uses two conflicting clip limits

**Evidence:** `lib/film/coverage.ts:11–16`, `lib/film/coverage.ts:55–56`, `lib/film/coverage.ts:265–268`; rounding in `comfy/workflows/h3-ref2video-film.ts:27`.

The packer uses `MAX_CLIP_SEC = 10 - 17/24`, approximately 9.292 seconds. However, `splitLongShot()` only splits above 10 seconds. The packer always accepts an oversized single shot because its overflow check only applies when the current clip already contains a shot.

**Reproduction:** An 18-word line plus lead-in requires approximately **9.882 seconds**, is not split, and produces a clip with **237 frames**. The workflow rounds that up to **243 frames = 10.125 seconds**.

**Impact:** The internal safety limit is violated. Whether this fails on a specific GPU was not tested; the confirmed defect is the broken duration invariant, not a particular model failure.

**Recommendation:** The splitter and packer must use the same workflow capabilities and validate the actual rounded render length. An oversized single shot must be split or explicitly rejected.

### R6 · P2 · Reference overflow silently turns visible speakers into offscreen speakers

**Evidence:** `lib/film/compose.ts:79–81`, `lib/film/compose.ts:136–144`.

All visible characters in a clip are combined and then truncated with `slice(0, room)`. A location image already consumes one of the nine slots. Selection prioritizes neither dialogue speakers nor individual shots. A character without a selected subject is treated as an offscreen voice when dialogue is written.

**Reproduction:** Nine visible characters and one location; the ninth character speaks. Requests contain character images only for `c0` through `c7`. The ninth character's dialogue remains, but has **no `subject`** and is emitted as offscreen dialogue in the prompt.

**Impact:** A technical reference limit changes the staging and can remove actions or speakers from the picture. The limit can also be exceeded by combining several smaller shots into a single clip.

**Recommendation:** Check reference requirements during packing and split clips at shot boundaries. If a single shot needs too many identities, report an explicit planning error. A speaker should only be taken out of the picture when an offscreen or cutaway arrangement was explicitly planned.

### R7 · P2 · The film render hash does not capture the actual dependencies

**Evidence:** `lib/film/render.ts:12–13`, `lib/film/render.ts:30–34`, `lib/film/assemble.ts:47–51`.

`promptHash()` only includes prompt text and planned frames. It excludes reference-image contents, workflow, render resolution, and the pinned starting frame. Re-rendering a preceding scene can therefore make a successor stale without changing its hash. The renderer warns based on modification times when a starting frame is newer, but assembly does not enforce this dependency. The stale check is also skipped if the sidecar or hash is missing.

**Reproduction:** Two requests with the same prompt and frame count but different `startsFrom` values and image paths produce the same hash. This follows directly from the hash function; file contents are not checked either.

**Impact:** A final film can contain outdated visual continuity or references despite passing prompt validation. This is independent of R1: it concerns existing results whose provenance checks are incomplete.

**Recommendation:** Use a versioned render manifest containing content fingerprints of all inputs and the workflow version. External or historical clips without a manifest need an explicit import status rather than implicitly counting as current.

### R8 · P2 · The cache dependency graph does not fully describe the data actually read

**Evidence:** `lib/project.ts:164–186`, `index.ts:281`, `index.ts:429–478`, `lib/film/store.ts:14`, `film.ts:234`, `film.ts:110–118`, `film.ts:301–315`.

Specific discrepancies:

- `lyricsTiming` reads `music.sections`, but the store declares only a dependency on `transcript`.
- `beats` reads music duration and the end of aligned vocals, but depends on neither `music` nor `lyricsTiming`. A new song can therefore retain the previous beat count and time-related planning.
- The film summary is generated from both `screenplay` **and `cast`**, but depends only on `screenplay`.
- `locationViews`/`sequenceSheets` control conditional generation and coverage in the film pipeline, but corresponding configuration fingerprints are missing. Existing coverage can remain unchanged when designed location views are enabled.

**Reproduction:** After `ProjectStore.invalidate('music')`, both `lyricsTiming` and `beats` remained present. After `FilmStore.invalidate('cast')`, the old summary remained present.

**Impact:** `--redo` and input changes propagate less far than the actual readers of each step require. The pipeline combines states that are type-compatible but belong to different content revisions.

**Recommendation:** Declare step definitions, input selection, configuration dependencies, and fingerprints together. Protect dependencies with small mutation checks: changing a domain input must invalidate every downstream reader. Manual edits to `project.json` also need a detectable revision or an explicit replanning step.

### R9 · P2 · Selective scene planning can reintroduce globally invalidated coverage

**Evidence:** `film.ts:82–87`, `film.ts:110–118`, `film.ts:338–345`.

`keptCoverage` is taken from the loaded state before `--redo` invalidation and before `syncInputs()`. The coverage loop later reuses those old scenes when they are not listed in `--scenes`. It does not check whether the screenplay, cast, look, or inputs were globally changed in the meantime.

**Trigger:** For example, `--redo=screenplay,coverage --scenes=s2`, or an edited `screenplay.txt` together with `--redo=coverage --scenes=s2`.

**Impact:** A new screenplay receives old shots with scene-local dialogue indices from the previous screenplay. Depending on the change, this assigns the wrong lines or causes composition to access dialogue lines that no longer exist. Scene IDs are positional as well, so they are not stable identities after insertions.

**Status:** Confirmed by control flow; no full CLI run with an LLM was executed.

**Recommendation:** Allow selective reuse only when the screenplay, cast, and relevant context revisions match. Include a handover fingerprint for scene transitions. Globally invalidated shots must not return unchecked from a previously captured snapshot.

### R10 · P2 · Atomic saves do not prevent lost updates between processes

**Evidence:** `lib/project.ts:217–220`, `lib/film/store.ts:58–61`; project-bound remote names in `lib/render.ts:64–65`, `lib/render.ts:104`.

Both stores load the entire state and later write it back in full. Neither locking nor revision comparison is present. A temporary file followed by rename protects against a truncated destination file, but not against overwriting a state that another process has advanced. The fixed `.partial` name also creates a shared temporary path during simultaneous saves.

**Reproduction:** Two stores load `{}`. Process A saves `summary`; process B saves `lookBrief` from its older snapshot. The final file contains only **`{ lookBrief: 'process B' }`**; the summary is lost. This requires no timing-sensitive race.

**Impact:** Two terminals or overlapping planning/rendering runs can lose results. Shared pending files, remote paths, and client IDs introduce further shared resources; their specific races were not separately reproduced.

**Recommendation:** Start with a simple exclusive project lock for writing runs, including a PID/run ID and defined handling of abandoned locks. Add unique temporary filenames. Optimistic revisions are useful if concurrent editing becomes an explicitly supported feature later.

### R11 · P2 · A failed LLM stream can be saved as a successful answer

**Evidence:** `lib/llm.ts:95–124`, `lib/llm.ts:168`, `lib/llm.ts:259–264`.

The event switch handles `response.completed`, `response.incomplete`, and `error`, but not `response.failed`. After the stream, it does not require a successful terminal event. Nonempty text is enough for `ask()` to succeed. Other incomplete reasons are only warned about.

**Reproduction:** A local SSE server first emits `response.output_text.delta` with `{"valid":true}`, followed by `response.failed` with `server_error`. `ask()` successfully returns **`{"valid":true}`** after exactly one call.

**Impact:** A partial result explicitly marked as failed by the server can enter the project cache. JSON repair may additionally make some partial answers syntactically parseable; that does not establish semantic completeness.

**Recommendation:** Explicitly require successful terminal status, reject failure/abort statuses, and distinguish transport failures from syntax and schema errors. Retries should be bounded and understandable for each category.

### R12 · P2 · Ambiguous character and location names are not resolved uniquely

**Evidence:** `lib/film/screenplay.ts:145–170`, `index.ts:301–312`.

Film conversion assigns unique IDs but does not check whether the same normalized alias belongs to multiple characters or locations. `characterOf()` and `locationOf()` return the first match. The music pipeline also lacks uniqueness checks for slugs derived from names: names such as `A B` and `A-B` produce the same key and overwrite look/description entries.

**Reproduction:** A film cast containing Anna with alias `A` and Ben with alias `A` is accepted. `characterOf(cast, 'A')` returns **Anna**. Neither `toCast()` nor coverage flags the ambiguity itself.

**Impact:** Voices, shots, or references can be assigned to the wrong character or location. Changing array order then changes the result.

**Recommendation:** Build a normalized name index with unique ownership and return ambiguities to the planner. Assign collision-safe IDs in the music pipeline as well as the film pipeline. Use stable IDs for subsequent references, with names reserved for display and import.

### R13 · P2 · Assembly confuses source frames with target-format frames

**Evidence:** `lib/film/assemble.ts:54–56`, `lib/film/assemble.ts:82`, `lib/assemble.ts:79`, `lib/assemble.ts:112`.

The length check directly compares the source video's frame count with the planned frame count on the 24-fps target grid. The `fps=24` filter is applied only later. With `useRendered`, the film pipeline also carries the raw source frame count forward as the target frame count.

**Reproduction:** An FFmpeg-generated **4-second clip at 12 fps with an audio track**. A plan containing 96 target frames should fit exactly after conversion. Instead, `assembleFilm()` fails beforehand with **`has 48 frames, but the clip needs 96`**.

**Impact:** The advertised support for differing frame rates does not work for this valid case. Higher frame rates combined with `useRendered` also risk incorrect timing/audio assumptions; that second case was not additionally executed.

**Recommendation:** Model media duration and the source time base separately from target frame counts. Either normalize before checking or correctly map available duration onto the target grid. Start/end frames and audio cuts must then use the same time base.

## Story quality and structural risks

These are design observations, not additional confirmed defects.

### Continuity is largely unstructured prompt context

In the music pipeline, `stateAfter` contains free-form strings. `lib/compose.ts:282–320` accumulates them, filters by the current location or immediately preceding beat, and limits their number. This has two consequences: character-bound states can disappear from context after multiple location changes, and contradictory statements such as “door open” followed by “door closed” have no machine-readable supersession rule.

The film pipeline primarily passes on `ends` from the immediately preceding scene. This is a useful handover, but not a complete state model for a film with time jumps, parallel action, and recurring locations.

**Improvement:** Introduce a small state model for the properties actually needed: character, location, clothing/look, held object, and the state of key props and sets. Each beat or scene produces explicit changes. Keep free-form direction alongside it. A full physics simulator is unnecessary.

### Prompt rules still replace domain contracts too often

`askJson<T>()` provides JSON parsing, but `T` is not runtime validation. The film pipeline already has useful boundary conversions in `toScreenplay()` and `toCoverage()`. Music cast and beat generation rely more heavily on the expected shape and sometimes replace unknown locations or characters with fallbacks. This can make a plan that clearly needs repair appear usable.

There is also a global music-video direction rule in `index.ts`: `filmableRules` forbids certain supernatural depictions and nonhuman faces, while the same pipeline supports groups of creatures. The hard-coded name `KASPAR` in `riskyMoment` is another sign that project-specific symptoms have become global rules. These are specific model/project decisions, not universal laws of story creation.

**Improvement:** Separate mandatory domain constraints, workflow limits, model heuristics, and project-specific direction. Structural errors must trigger targeted repair; aesthetic guidance can deliberately remain advisory.

### Automatic screenplay repair bypasses the dependency graph

`film.ts:192–197` replaces the screenplay directly and removes only coverage and script notes. On subsequent runs, cast, summary, location views, and looks can remain from the old screenplay. Restricting edits to action and time of day does not automatically make these data independent: action can change clothing, props, presence, or the state of a set.

**Improvement:** Treat repairs as explicit revisions with affected domain properties. Invalidate dependent steps deliberately instead of bypassing the store graph through direct mutation. Export the concrete diff before expensive downstream stages.

### A completed plan is not a validated film

Image and speech models can deviate from prompts. The current film flow checks technical media properties, but not whether the rendered dialogue was spoken in full, whether the right person speaks, or whether an essential action is missing. Avoiding Whisper as the sole hard gate is understandable; it does not imply that all semantic output checks should be omitted.

**Improvement:** Separate technical blockers from uncertain quality indicators. Offer a review export with expected dialogue, actual measured duration, suspicious passages, and preview images. Treat automated speech/image analyses as confidence-qualified hints, not infallible quality judgments.

### Planned time and actual edit time are different outputs

`timeline.edl` and `timeline.json` are generated from planned frames. Film assembly retains the actually rendered frames for dialogue clips and removes one frame at continuity joins. Consequently, the exported EDL can differ from the finished MP4. Runtime targets have the same distinction: target duration is a soft planning budget, while actual speech may take longer.

**Improvement:** Explicitly distinguish the planning timeline from the realized edit list. After rendering, compute one shared realized timeline from which MP4, EDL, subtitles, and runtime reports are derived. A hard runtime requirement needs its own validation/replanning process.

## Highest-value refactorings

### 1. A render request with traceable provenance

A canonical `RenderSpec` should include the prompt, workflow version, resolution, effective seed, target/render frames, and asset fingerprints. `PendingJob`, sidecars, and the final edit should reference the same spec ID. This addresses the shared foundation of R1, R2, and R7. A new filename alone is insufficient; all consumers must check provenance.

### 2. Separate pure planning from execution

`index.ts` and `film.ts` combine CLI parsing, state mutation, LLM calls, planning, export, and rendering. Useful initial boundaries are `planMusicProject`, `planFilm`, `validatePlan`, `executeRenderPlan`, and `assembleTimeline`. The CLI should primarily wire these functions together.

Give each plan a validation report and revision. Only valid plans may produce media requests. This moves reference-budget and duration-limit checks ahead of the first upload instead of discovering problems during GPU execution.

### 3. Extract a small shared store core

`ProjectStore` and `FilmStore` duplicate loading, saving, invalidation, and step caching. A common core for locking, revisions, atomic saves, and fingerprints is useful. Keep domain steps and dependency graphs separate: music and film have different timing and audio models.

Do not simultaneously unify the two large composers. Extract shared mechanics first; a generic universal pipeline would tend to obscure the domain differences.

### 4. Define time bases and workflow capabilities centrally

A workflow should declare reference limits, audio limits, supported frame counts, maximum render frames, and target frame rate. Splitters, packers, renderers, and assemblers should consume the same contract. Distinguish `PlannedFrames`, `RenderedFrames`, and `SourceFrames` at least through clearly named types/functions.

### 5. Runtime validation at external boundaries

Validate LLM answers and `project.json` on ingestion: nonempty arrays, unique IDs/aliases, known references, finite numbers, valid dialogue indices, and consistent scene coverage. A parser may tolerate and correct syntax, but it must not silently mark an incomplete story as semantically valid.

### 6. Persist results per scene and character

Coverage and several look-generation steps collect many individual LLM calls and save only at the end of the entire step. If the last scene fails, earlier successful calls from that step are lost. Persisting each element with its input fingerprint enables targeted resumption and also supports selective scene planning.

## Recommended order and regression tests

1. **Secure render provenance:** address R1/R2/R7 together; cover changed prompts, images, workflows, pinned frames, and existing pending jobs. Old results must never receive metadata from a new plan.
2. **Enforce plan invariants:** R4/R5/R6; cover late downbeats, long bar intervals, an 18-word dialogue line, many characters across multiple shots, and complete/gap-free timeline coverage.
3. **Source fidelity and identity:** R3/R12; cover omitted, reordered, and duplicate lines, wrong speakers, overlapping aliases, and slug collisions.
4. **State consistency:** R8/R9/R10; cover every actual cache dependency, combined global/selective redos, and two writing runs.
5. **LLM and media boundaries:** R11/R13; SSE tests for `response.failed`, missing terminal status, and incomplete reasons; small FFmpeg fixtures at 12/24/48 fps with differing audio durations.

The passing test suite does not contradict these findings. It covers many local normalization rules, but provides little coverage of the transitions between cache, pending job, actual media, and final edit. `lib/render.test.ts` currently checks only the three cases of the boolean resume decision. These transitions should be the focus of the next tests.

## Limitations and security assessment

This was a focused correctness/architecture review in five areas: orchestration/store, story import, shot/timeline planning, rendering, and assembly. It was not a complete audit of every helper tool, Python model, or transitive dependency. No CVE/license audit or ComfyUI server configuration review was performed. Generated `nodes.ts` is explicitly excluded.

The inspected process invocations do not establish a concrete shell-injection finding: programs are predominantly launched using argument arrays. Workflow configuration does load local TypeScript modules, however, so external projects and workflows are not passive data. This is a trust boundary worth documenting, without claiming an exploitable security vulnerability in the absence of further evidence.

The 13 findings are confirmed either through small local reproductions or the identified control flow. Consequences not separately executed, and assumptions about model quality, are identified accordingly. No additional candidates are presented as confirmed security vulnerabilities.