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

Feature ownership, API/state rules and the migration order are in the
[implementation plan](../docs/superpowers/plans/2026-11-03-vue-workspace-client.md).
