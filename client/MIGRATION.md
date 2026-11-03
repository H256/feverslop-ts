# Vue migration status

Baseline: `main` at `97bb1f4` (2026-11-03). Tracker: [#554](https://forgejo.elysium.lan/H256/feverslop-ts/issues/554).

| Issue | Scope | Status |
| --- | --- | --- |
| [#555](https://forgejo.elysium.lan/H256/feverslop-ts/issues/555) | Separate client, build/install, static serving, opt-in preview | Implemented in this change |
| [#556](https://forgejo.elysium.lan/H256/feverslop-ts/issues/556) | API contracts, application shell, jobs, overview, library | Partly: shared contracts (`shared/workspace.ts`), shell, project overview and library browser done; jobs/run log pending |
| [#557](https://forgejo.elysium.lan/H256/feverslop-ts/issues/557) | Story, casting, look and references | Pending |
| [#558](https://forgejo.elysium.lan/H256/feverslop-ts/issues/558) | Singers and timing | Pending |
| [#559](https://forgejo.elysium.lan/H256/feverslop-ts/issues/559) | Timeline, player, inspector, review | Pending |
| [#560](https://forgejo.elysium.lan/H256/feverslop-ts/issues/560) | Feature parity, distribution, default switch, legacy removal | Pending |

The preview shows the project overview and the library browser. Project pages (`/p/...`) and
asset creation (`/library?legacy=1`) are still served by the existing page until their issues land. Do not switch
the default until the feature matrix and cutover criteria in the
[plan](../docs/superpowers/plans/2026-11-03-vue-workspace-client.md) pass.

Foundation validation covers artifact replacement/rollback, invalid manifests and linked
files, static MIME/cache/HEAD handling, API isolation, existing startup behavior, and a real
Chromium session against the installed build. It does not establish editing, rendering or
playback parity; those need the fixtures and browser scenarios assigned to the later issues.

## Coordination

Before each follow-up, fetch main and compare changes to `lib/editor/page.html`, routes and
contracts against the baseline. Transfer new features into the migration inventory before
porting. Keep feature PRs bounded by the issue split above; coordinate shared shell/router,
API contracts and root package files through one owner. Never overwrite another worktree
or copy an older full-page snapshot over newer functionality.
