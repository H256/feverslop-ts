# Vue migration status

Baseline: `main` at `97bb1f4` (2026-11-03). Tracker: [#554](https://forgejo.elysium.lan/H256/feverslop-ts/issues/554).

| Issue | Scope | Status |
| --- | --- | --- |
| [#555](https://forgejo.elysium.lan/H256/feverslop-ts/issues/555) | Separate client, build/install, static serving, opt-in preview | Done |
| [#556](https://forgejo.elysium.lan/H256/feverslop-ts/issues/556) | API contracts, application shell, jobs, overview, library | Done: `shared/workspace.ts`, shell services, run dock, overview, library with asset creation |
| [#557](https://forgejo.elysium.lan/H256/feverslop-ts/issues/557) | Story, casting, look and references | Done |
| [#558](https://forgejo.elysium.lan/H256/feverslop-ts/issues/558) | Singers and timing | Done |
| [#559](https://forgejo.elysium.lan/H256/feverslop-ts/issues/559) | Timeline, player, inspector, review | Ported; playback against real media not yet checked by hand |
| [#560](https://forgejo.elysium.lan/H256/feverslop-ts/issues/560) | Feature parity, distribution, default switch, legacy removal | Open: hand check with real projects, then default switch and removal of `page.html` |

Every page of `lib/editor/page.html` has its Vue counterpart. The Vue client stays opt-in
(`FEVERSLOP_EDITOR_UI=vue`) until the hand check below passes; then the default switches and
the legacy page goes in a separate cleanup commit.

## How the client is built

- `shared/workspace.ts`: the wire contracts. The server modules re-export them, so a drift is a
  type error on either side. `RunAction` on the server is the page's `RunRequest` plus what
  only the server sets.
- `src/services/`: the shell's services, made once in `App.vue` and handed down by
  provide/inject - toasts, questions (`ask`), viewer, render servers, run dock, top bar.
- `src/features/project/session.ts`: one project while its pages are open, made by
  `ProjectLayout` per `(kind, id)`; another project is another session.
- Each page: a page component that loads, components for its content, the logic that needs no
  DOM in a plain module (`listing.ts`, `parts.ts`, `words.ts`, `clips.ts`, `stages.ts`) and a
  composable for its draft (`useSingingDraft`, `useTimingDraft`, `useLookEdits`, `useDraft`).
- Timeline: `usePlayback` is the monitor's algorithm of the legacy page, unchanged - two
  videos taking turns, the song under them with drift correction, the clock in gaps. Per
  frame only the playhead and the time change; the track's `--t` is set on the element.

## Tests

- `bun run client:test`: the pure modules (overview, singer parts, timing words, clips, stages).
- `bun run client:e2e`: the real editor with the installed build. Overview, library and every
  project page against a synthetic project (`tests/e2e/fixtures.ts`), with the requests each
  write action sends checked against the server's contract.

## Hand check before the default switch

Not covered by the automated tests, to be looked at with real projects:

- Playback: clip boundaries, the song under the clips, a gap, the final video, a preview and a
  variant, speed and loop, the peek over the clips.
- Timing: dragging words and edges on a real waveform, Ctrl+wheel.
- A run started here: log, progress on the clip blocks, stop, the review or comparison after a
  render again, a failed run's bar.
- Library: making an asset from a picture.

## Coordination

Before each follow-up, fetch main and compare changes to `lib/editor/page.html`, routes and
contracts against the baseline. Transfer new features into the Vue client before the legacy
page is removed. Never overwrite another worktree or copy an older full-page snapshot over newer
functionality.
