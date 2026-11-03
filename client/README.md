# Workspace client

Vue 3 + TypeScript + Vue Router, built with Vite. This is an **opt-in infrastructure preview**;
project editing and pipeline controls still live in the default legacy workspace.
Follow [MIGRATION.md](MIGRATION.md) for the remaining feature work.

## Build and run

From the repository root (Bun and Node ^20.19 or >=22.12 on PATH):

```sh
bun run client:install
bun run client:build
```

The build typechecks the client, emits `client/dist`, validates the manifest and HTML asset
references, then stages and installs the files into `lib/editor/public`. Stop the preview
server before rebuilding. An invalid build leaves the installed directory unchanged; a
failed replacement attempts to restore the previous directory. If restoration itself fails,
the `.public-backup-*` sibling is retained for manual recovery.

Run the installed preview in PowerShell:

```powershell
$env:FEVERSLOP_EDITOR_UI = 'vue'
bun run editor
```

Stop the server and remove the opt-in to return to the full existing workspace:

```powershell
Remove-Item Env:FEVERSLOP_EDITOR_UI
bun run editor
```

Without this environment variable, the existing workspace remains the default and needs no
client build. An explicitly selected Vue UI with no installed build fails with build instructions.
Production serves everything from Bun on the same origin; Node/Vite are build tools only.
There is no CDN, Vite dev-server dependency, API proxy or second production server.

## Checks

```sh
bun run client:check
bun test ./lib/editor
bun run typecheck
# Once per developer/CI browser environment:
node client/node_modules/@playwright/test/cli.js install chromium
bun run client:e2e
```

The browser check builds and installs the production artifact, starts the real Bun editor
with a temporary empty project directory, and verifies navigation, direct URLs, local-only
assets, console errors and missing routes. It does not call external generation services.
Run backend tests with `bun run test`; Playwright tests have their own runner.

## Boundaries

- Client imports stay inside `client/`; no pipeline/server imports in browser code.
- Browser configuration must not contain credentials or provider settings.
- Assets use `/workspace-assets/`; history routes use `/`. API/media responses never fall
  back to the SPA. Hidden files, manifests, source maps and path escapes are not served.
- `dist` and `lib/editor/public` are ignored build outputs. Packaging and deployment must
  run the client build and include the installed `public` directory before opting into Vue.
- Both root and client dependencies have separate lockfiles. Use frozen installs for both.

Feature ownership, API/state rules, migration order and cutover criteria are in the
[implementation plan](../docs/superpowers/plans/2026-11-03-vue-workspace-client.md).
