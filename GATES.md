# Gates: Vue workspace foundation (#555)

OWNS: client/**, lib/editor/**, tools/build-client.ts, lib/cli.ts, package.json, tsconfig.json, .gitignore, docs/**, GATES.md

Scope: Begin migration with an opt-in Vue client, validated artifact installation and Bun serving; keep legacy default and feature migration tracked separately.

- [x] G1: Invalid artifacts preserve the old build and static routes retain isolation and HTTP semantics.
  CHECK: bun test ./lib/editor
  EXPECT: 0 fail
  EVIDENCE: automatic-evidence=v1; definition-sha256=ed424ee7b0c3ed428cd2568d1b6e0acbdb2d0a8eba13cbb039a3e786e38254d2; exit=0; EXPECT=matched; output-sha256=868c24fffe4d6d3afbeaa9607cfc1618e8267c4b81302ae3b68e0a6282f43a67; output-bytes=14015; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\kleme\orca\workspaces\storymaker\remora; path=0ee508887804/57 entries

- [x] G2: The real client typechecks, builds and installs successfully.
  CHECK: bun run client:build
  EXPECT: Client installed
  EVIDENCE: automatic-evidence=v1; definition-sha256=f71e9032a5eeb7aeac68d63dcedf0c61882f41f42f68ce9fb1ef565c1baec56f; exit=0; EXPECT=matched; output-sha256=a6fe94dba186c73ad4a9af0ce614660a5fe6e89230a309299262d668fb82a5b2; output-bytes=634; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\kleme\orca\workspaces\storymaker\remora; path=0ee508887804/57 entries

- [x] G3: Root typecheck remains separate from the client.
  CHECK: bun run typecheck
  EXPECT: No type errors
  EVIDENCE: automatic-evidence=v1; definition-sha256=c357230107a0eb4fef314473f1361228cb090fda861fcc24db7ca01d0b71054f; exit=0; EXPECT=matched; output-sha256=09ded43f224353fdafc89369261302bcc79d3fa56767aa219948f59b630097ce; output-bytes=211; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\kleme\orca\workspaces\storymaker\remora; path=0ee508887804/57 entries

- [x] G4: CLI script help remains usable without launching a build.
  CHECK: bun test ./lib/cli.test.ts
  EXPECT: 0 fail
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6d967f012a025f4b78ea6a1bcd2aad0f60cf8977cdb6524bbd2467932e29d13; exit=0; EXPECT=matched; output-sha256=2ea38c63034a6912eb52cfa7687a01b5b93e3a2712c80e5a065eaf3bfb12f33e; output-bytes=844; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\kleme\orca\workspaces\storymaker\remora; path=0ee508887804/57 entries

- [x] G5: The installed opt-in client boots in a browser without external assets or console errors; legacy remains the default.
  CHECK: bun run client:e2e
  EXPECT: 1 passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6797efbe0a0882f133481c70c19039002d11daa3017e31a3c880ab82bcb82ad; exit=0; EXPECT=matched; output-sha256=c25ddd7366aa6f0208717bc4704b7b6a3945a790b783f0c17f9b0c3c2665fd46; output-bytes=1055; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\kleme\orca\workspaces\storymaker\remora; path=0ee508887804/57 entries

- [x] G6: Migration issues and plan cover all current views; review and scoped PR document the remaining migration.
  EVIDENCE: Tracker #554 and implementation issues #555–#560 created; plan and client/MIGRATION.md map the remaining views. Independent reviewer /root/review_startup reported no material findings. PR https://forgejo.elysium.lan/H256/feverslop-ts/pulls/561 scopes this change to #555. Full backend suite: 749 pass, 1 expected skip, 0 fail. One build failure during the gate run was not reproducible in the direct and repeated gate run; recorded in PR limitations.
