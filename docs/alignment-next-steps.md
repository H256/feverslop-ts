# Timing refinement after the baseline

The optional IPA pass and editor fixes are the baseline in [#952](https://forgejo.elysium.lan/H256/feverslop-ts/issues/952).
It proposes complete word spans for explicit review; it is not an automatic onset-only correction.

Further experiments, results and downloadable handoffs are collected separately in
[#953](https://forgejo.elysium.lan/H256/feverslop-ts/issues/953): composite-phone coverage,
prefix repair, acoustic endpoints, pitch and English SOFA. None of those experimental
policies is enabled by this baseline.

Next priorities are coarse passage localisation, isolating unsupported pronunciations,
and evaluating endpoints independently from onsets. Preserve genuinely held notes and
manual anchors. Missing transcript matches remain reviewable omission proposals.
Obtain a French reference before claiming measured French singing accuracy.

## Reproduction

Set `ALIGNMENT_LIBRARY` to the library's `songs` directory and optionally
`ALIGNMENT_OUTPUT` to a fresh output directory. Run:

```text
bun tools/alignment-library-benchmark.ts
bun tools/alignment-policy-report.ts <output-directory>
```

The runner reads four named references, reconstructs coarse timing without hand
times, runs the pinned model and checks source hashes. It needs the local audio,
ffmpeg, uv and the dependencies described in timing-refinement.md. Outputs contain
local paths and lyrics; do not publish them automatically. The report can also run
against existing cached outputs without inference. It calls the real application
policy on in-memory copies and never saves to the library. Raw coverage and applied
coverage are reported separately: omitted sung lines count as missing, not accurate.
Library exports contain no project singer assignments, so this evaluation does not
exercise same-singer collision protection; dedicated tests cover that rule.
