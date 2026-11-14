# Comparison against hand-corrected timing

Reference: `library/songs/mehr-als-code-261112/song.json` from the main checkout, inspected 2026-11-13. It contains 42 lines, 37 marked as hand-edited, and four disabled ad-lib suggestions. The reference was read without modification.

Compared the previously generated batch IPA candidates against the reference for the 12 active, hand-edited canonical lines in the initial verse/chorus sample. Line ID and exact lyric text had to agree. The model run preceded this reference; it did not receive the corrected times or their anchors. The baseline is the original rough timing retained in that run's input snapshot.

| Absolute boundary error | Rough baseline | Raw batch IPA proposal |
| --- | ---: | ---: |
| Mean onset error | 293 ms | 93 ms |
| Median onset error | 249 ms | 66 ms |
| Mean end error | 924 ms | 154 ms |
| Median end error | 422 ms | 52 ms |

These numbers measure the candidate model output, before the acceptance policy withholds conflicting lines. They are not the error of a fully applied proposal. This is one German development song and a small sample, not validation for English/French or a claim of phoneme-level accuracy. The known “Zahl” error and disagreements between adjacent windows still require a confirmed anchor or manual correction. Timing for absent lyrics and disabled ad-libs was excluded from the boundary-error calculation.

Local row-level results are kept in `.tmp/alignment-reference-eval.json`; the model input/output snapshots are in `.tmp/alignment-integration-project/.timing-refinement/`.
