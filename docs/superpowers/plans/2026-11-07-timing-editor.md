# Timing editor implementation plan

> Execute using subagent-driven-development, with test-first changes and independent review.

**Goal:** Implement #629: fast correction of inaccurate lyric timing and reversible word parts without corrupting audible timing.

**Architecture:** Preserve source words using optional `joined` continuation metadata; preserve editable anchors and provisional review status on words. Timing-only callers remain supported; structural callers supply full words, validated against the saved source text. The client edits a reversible draft and the server updates slot vocals atomically.

**Tech Stack:** TypeScript, Vue 3, Bun tests, Playwright.

## Tasks and acceptance gates

- [x] Persistence and prompts: extend shared TimingWord/TimedWord with `joined?: boolean`, `anchor?: boolean`, `estimated?: boolean`, `group?: string`; TimingChange.words accepts optional text and metadata. Full structural submissions must reconstruct exactly the saved source words (joined means no space). Reject invalid submissions before mutation. Preserve legacy timing-only requests. Remap singer part indices on split/join. Decorate fragments only in clip prompt text; rejoining restores original text. Detect stale prompt text as well as spans. Test split/save/reload/join and boundary prompts before implementation.
- [x] Editing operations and draft: add tests for bounded multiword translation, fitting between confirmed anchors, split/join, grouping, onset marks, and undo/redo. Implement pure operations in client/src/features/timing, then integrate draft selection across lines, metadata-preserving history and serialization. Remove conflict trimming and silent neighbor shortening.
- [x] UI: contextual selection controls, two-point fitting with preview, anchor toggles, reversible grouping, split text/time inputs, clip preview, stable drag viewport, snapping bypass, shared boundary editing and keyboard access.
- [x] Listening workflow: mark onsets with a key, explicit final end, backspace, pause/resume/restart, speed and loop controls, reaction offset; derived word ends remain provisional. Preserve edits on save/refresh; separate unchecked/conflict navigation.
- [x] Verification: root/client typechecks, backend and client unit suites, client build and browser regression tests. Independently review specification coverage then correctness. Real model lip-sync is not claimed without rendering.

## Explicit follow-up

Local clip-boundary movement remains separate. Existing cuts stay fixed. No automatic song replanning, rendering, or transcript edits.

## Commands

`bun test ./lib/editor/timing.test.ts ./lib/lyrics.test.ts ./lib/singing-parts.test.ts`

`bun run client:test`

`bun run typecheck`

`bun run client:check`

`bun run test`

`bun run client:e2e`

## Verification result (2026-11-08)

871 backend tests passed, 1 pre-existing generated-Comfy-types test skipped; 46 client unit tests passed; 33 browser tests passed, then 8 timing browser tests passed again after the layout adjustment. Root/client typechecks and workspace startup passed. Independent reviews found metadata, fragment and undo/selection issues; all reported issues were fixed with regression coverage. Final follow-up review was interrupted by the provider usage limit. No real AI render was run. Changes remain local and uncommitted; issue #629 stays open.
