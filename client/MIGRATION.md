# Vue migration status

Baseline: `main` at `97bb1f4` (2026-11-03). Tracker: [#554](https://forgejo.elysium.lan/H256/feverslop-ts/issues/554).

| Issue | Scope | Status |
| --- | --- | --- |
| [#555](https://forgejo.elysium.lan/H256/feverslop-ts/issues/555) | Separate client, build/install, static serving, opt-in preview | Done |
| [#556](https://forgejo.elysium.lan/H256/feverslop-ts/issues/556) | API contracts, application shell, jobs, overview, library | Done: `shared/workspace.ts`, shell services, run dock, overview, library with asset creation |
| [#557](https://forgejo.elysium.lan/H256/feverslop-ts/issues/557) | Story, casting, look and references | Done |
| [#558](https://forgejo.elysium.lan/H256/feverslop-ts/issues/558) | Singers and timing | Done |
| [#559](https://forgejo.elysium.lan/H256/feverslop-ts/issues/559) | Timeline, player, inspector, review | Done; playback, runs and making an asset checked by hand on real projects |
| [#560](https://forgejo.elysium.lan/H256/feverslop-ts/issues/560) | Feature parity, distribution, default switch, legacy removal | Done: checked by hand on real projects; the default, built by `bun run editor` when stale; `page.html` removed |

Every page of the former `lib/editor/page.html` has its Vue counterpart, and the Vue client is
the only workspace page since v0.6.0: the former page and the `FEVERSLOP_EDITOR_UI` switch are gone.

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
- Timeline: `usePlayback` is the monitor's algorithm of the former page, unchanged - two
  videos taking turns, the song under them with drift correction, the clock in gaps. Per
  frame only the playhead and the time change; the track's `--t` is set on the element.

## Tests

- `bun run client:test`: the pure modules (overview, singer parts, timing words, clips, stages).
- `bun run client:e2e`: the real editor with the installed build. Overview, library and every
  project page against a synthetic project (`tests/e2e/fixtures.ts`), with the requests each
  write action sends checked against the server's contract.

## Hand check with real projects (2026-11-03)

Looked at with copies of real projects, against the former page side by side, before the switch:
the text of every page, playback (final video, clips under the song with the drift correction,
gaps), the questions before a run and before leaving with changes, dragging words on a real
waveform, the viewer. Runs started from the page and an asset made from a picture were checked
by hand afterwards. Not covered by the automated tests; to be looked at again when the player
or the run dock change.

## From here

New workspace features go into `client/` only; the server's API and the CLI stay what the page
calls (CLI first). There is no second page to keep in step.
