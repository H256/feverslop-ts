# Confirmed sung passage implementation plan

**Goal:** Explicitly retry a sung canonical line plus its immediate following line, with bounded context and review before persistence.

**Architecture:** Extend the shared timing refinement service with an optional confirmed-line request. A pure passage module selects one <=30s window, stages presence in memory and restricts proposed edits. Python accepts this explicit window without repartitioning the song. Apply uses existing fingerprints, backups, locks and invalidation; confirmation persists only alongside a usable selected-line result.

**Tech stack:** Bun/TypeScript, Vue, Python IPA/CTC, Playwright.

- [x] Add failing pure tests in `lib/editor/timing-passage.test.ts`: bounded context, only two targets, absent selected line included, manual anchors/off neighbours protected, unsupported target rejected, original data unchanged, invalid target candidates cannot change neighbour alone.
- [x] Implement `lib/editor/timing-passage.ts`; integrate scope/proposal fields in `shared/timing-refinement.ts` and shared build/prepare/apply in `lib/editor/timing-refinement.ts`. The selected target may be left out beforehand, but must not be manually timed/anchored/grouped/adlib. Following protected lines are context only.
- [x] Add failing explicit-window tests in `tools/test_refine_lyrics.py`, implement validation and one-window path in `tools/refine_lyrics.py`.
- [x] Add CLI `--refine-line=<one-based> --confirm-sung` alongside `--refine=<language>`, forward API request through existing route and client API; keep legacy whole-song path and old-proposal rejection intact.
- [x] Add browser regression for confirmation → proposal → explicit apply, no save during preparation, before/after listen controls and no unrelated line request. Implement selected-line UI action and scope disclosure.
- [x] Verify focused backend/Python tests, CLI parity, typecheck, client build and Playwright. Run real model/service smoke on an isolated Flimmernder copy, compare changed IDs and source hashes. Do not write the user's project or library.
- [x] Document limitations and scoped atomic adoption, review diff, commit/push separate PR. No automatic merge.

Target + eligible following line are one reviewed unit: accepting only one half could preserve the known overlap. Other lines serve as fixed context only. Missing words/zero-confidence elsewhere are never implicitly confirmed. A stale or unusable proposal must not change presence. No automatic presence classifier or new acoustic-score threshold.
