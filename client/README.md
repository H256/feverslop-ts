# Workspace client

Vue 3 + TypeScript + Vue Router, built with Vite: every page of the workspace. [MIGRATION.md](MIGRATION.md)
has how it came from the former single page, its structure and its tests.

## Build and run

`bun run editor` builds the page by itself when it is missing or stale, and then serves it.
Before each build it installs the client packages as `client/bun.lock` says - a pull may have
changed them. What counts is a stamp the build leaves in `lib/editor/public/.build-stamp`:
a hash over `client/` (sources, `public/`, settings, lockfile - not the tests), `shared/` and
the repository's `package.json`. A build handed over without `client/` is served as it is.

To build by hand, from the repository root (Bun and Node ^20.19 or >=22.12 on PATH):

```sh
bun run client:install
bun run client:build
```

The build typechecks the client, emits `client/dist`, validates the manifest and HTML asset
references, then stages and installs the files into `lib/editor/public`. Stop the editor
before building by hand. An invalid build leaves the installed directory unchanged; a
failed replacement attempts to restore the previous directory. If restoration itself fails,
the `.public-backup-*` sibling is retained for manual recovery.

The server answers a page with 503 and the build command when no build is installed; the
API keeps working. Production serves everything from Bun on the same origin; Node/Vite are build tools only.
There is no CDN, Vite dev-server dependency, API proxy or second production server.

## Checks

```sh
bun run client:check
bun run client:test
bun test ./lib/editor
bun run test:workspace   # builds, then the real editor with its page
bun run typecheck
# Once per developer/CI browser environment:
node client/node_modules/@playwright/test/cli.js install chromium
bun run client:e2e
```

The browser check builds and installs the production artifact, starts the real Bun editor
with a temporary empty project directory, and verifies navigation, direct URLs, local-only
assets, console errors and missing routes; every project page runs against a synthetic
project whose API is stubbed in the browser. It does not call external generation services.
Run backend tests with `bun run test`; Playwright tests have their own runner.

## Boundaries

- Client imports stay inside `client/`; no pipeline/server imports in browser code.
- Browser configuration must not contain credentials or provider settings.
- Assets use `/workspace-assets/`; history routes use `/`. API/media responses never fall
  back to the SPA. Hidden files, manifests, source maps and path escapes are not served.
- `dist` and `lib/editor/public` are ignored build outputs. Packaging without `client/` must
  include the installed `public` directory.
- Both root and client dependencies have separate lockfiles. Use frozen installs for both.

## Rules for work on the page

What held before the Vue client and still holds (from the former frontend guidelines, which are gone):

- **The pipeline decides, the page shows.** Planning, rendering, files, locks and every check belong to the commands and the
  server. A check on the page is for a quick answer and never replaces the server's. Every change the page makes is a
  command or the function a command calls (`lib/editor/cli-first.test.ts`).
- **Four kinds of state, each with one owner:** what the server said (a page's data), what the page shows (selection, tab,
  filter, zoom), what is being typed and not saved yet (a draft), and playback (time, the active video). A selection is kept
  by id, not by an object of an older answer.
- **A background refresh never overwrites what someone is typing.** A draft follows the data only while it is unchanged
  (`useDraft`); an older answer that comes late is dropped (`useResource`, the session's `reload`).
- **Whoever starts something ends it.** A timer, an event stream, a request belongs to the component or service that made it
  and goes with it (`onScopeDispose`); no module starts work by being imported.
- **Nothing starts by itself.** A run, a render and playback begin on a click. An effect that watches state never starts a
  job.
- **Errors by kind:** a first load that fails is shown with a retry; a later refresh that fails keeps what is shown and says
  so once; a change that fails is said at the action. No silent catch on an action of the user.
- **Text of projects, prompts and model answers is text:** never `v-html` for it.
- **Playback is not the page's clock.** The playhead and the time may run per frame; the inspector, lists and forms change
  when their own data does. Video and audio elements stay mounted, their source changes only when the file does.

Feature ownership, API/state rules and the migration order are in the
[implementation plan](../docs/superpowers/plans/2026-11-03-vue-workspace-client.md).
