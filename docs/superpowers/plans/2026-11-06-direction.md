# Direction Editing Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement the tasks with independent review. Execute continuously; the user authorized issue, implementation, commit and PR.

**Goal:** Tune existing performances through the CLI and web workspace while preserving story, cast, looks, sound and cut timing (issue #623).

**Architecture:** Keep verbatim direction rules and proposal/version state separate from generated planning steps. Separate music and film adapters expose editable shots and their stable context; a small direction service validates scoped edits, produces proposals with an injected LLM, and applies only structurally permitted changes. Pipeline integration detects a regenerated plan, retains broad intent and surfaces unresolved bindings; no silently reused shot IDs.

**Tech Stack:** Bun, TypeScript, Vue, existing project locks, JSON persistence, LLM client and run controller.

## Acceptance gates

- [x] An existing music/film plan can receive rules at project, character, scene/beat and shot scope; music supports song seconds.
- [x] CLI manages rules and JSON round trips, proposal/take/drop and restore without GPU work.
- [x] LLM edits structured fields with reasoning none for local edits; code preserves timing, identities, dialogue and unrelated project data.
- [x] Proposal shows before/after, chosen shots and conflicts; stale proposals cannot be taken.
- [x] New plans keep broad intent; unresolved/reused scene/shot bindings are explicit. Deleting intent does not claim to undo rendered action.
- [x] WebUI exposes scope, rules, comparisons, conflicts, restore and entry from shots using CLI/shared CLI operations.
- [x] Documentation and meaningful backend/frontend tests cover the contract.

## Task 1 — CLI domain and planning integration

Files: new `shared/direction.ts`, `lib/direction/` (contracts/service/prompt/music/film adapters/tests), `tools/direction.ts`; modify `index.ts`, `film.ts`, `package.json`, `lib/cli.ts`, `lib/cli-help.ts`.

- [x] Write failing tests for scoped selection, no silent ID rebinding, protected fields, malformed model responses, conflict rejection, stale proposal rejection, take/drop/restore and project locks.
- [x] Run `bun test ./lib/direction` and confirm missing behavior fails.
- [x] Implement typed rules, validated persistence and proposal lifecycle. Preserve original instructions. Pass prior/next context to an edit-specific prompt; structurally validate the complete response before writing anything.
- [x] Implement separate pipeline adapters; local edits retain shot count, timing and dialogue. Replanning detects changed source snapshots and forces review instead of attaching old shot instructions to reused indices.
- [x] Implement `bun run direction <id> [--film]` with list/JSON, add/edit/remove/set, preview/take/drop/restore. No network call for read-only/list/save/take/drop operations.
- [x] Add hooks before request composition so accepted direction reaches requests and replan state is checked. Never call GPU from this command.
- [x] Run focused tests and backend typecheck; review spec and correctness independently before UI work.

## Task 2 — Workspace integration

Files: `lib/editor/server.ts`, `lib/editor/runs.ts`, `shared/workspace.ts`, `client/src/api/project.ts`, new `client/src/features/direction/DirectionPage.vue`, `client/src/router.ts`, project navigation and shot inspector; backend route/run and client tests.

- [x] Write failing tests proving direction routes and CLI action translation use the backend contract and cannot mutate a running project.
- [x] Add GET/mutation endpoints for the same CLI service and a CLI-run action for LLM proposals. Expose CLI-equivalent commands in the page.
- [x] Build a scope form, rule list/edit/delete, proposal before/after and conflict view, take/drop and restore. Use existing busy state and unsaved-change guards.
- [x] Link from project navigation and individual shots without guessing shot identifiers from display ordinals.
- [x] Verify workspace routes, client tests, typecheck/build and an interaction test against a disposable fixture.

## Task 3 — Documentation, review and delivery

Files: `README.md`, `docs/direction.md`, `docs/recipes.md`, `docs/workspace-guide.md` and this checklist.

- [x] Document actual CLI examples, JSON form, scope precedence, motion/camera edits, film/music differences, replan behavior, conflicts, render freshness and removal versus restore.
- [x] Run backend tests, backend/client typechecks, client tests/build and focused workspace checks. Fix failures without updating unrelated golden outputs.
- [x] Independently review the final diff against issue #623, repair findings, inspect git status/diff.
- [x] Commit, push the feature branch, open a PR against current main with issue link and validation evidence. Leave merging to the user.
