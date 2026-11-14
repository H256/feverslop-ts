# Full-library timing comparison — 2026-11-13

Compared four distinct recordings from the main checkout library. `epa-streikt` and `epa-streikt-261104` have identical audio fingerprints; the latter has more manual corrections (56 active canonical lines versus 47) and is the EPA reference. The older export is not counted as an independent song.

All reference `song.json` and `lyrics.txt` files were read only and their SHA-256 hashes verified unchanged after inference. No corrected times, manual anchors or by-hand flags were passed to the model. The baseline was reconstructed from the saved Whisper transcript, the library lyrics, song sections and vocal waveform using the current `alignLyrics` / `tightenStarts` implementation. Thus this tests today's baseline algorithm, not a preserved historical Whisper alignment.

The phoneme pass uses the existing production helper `tools/refine_lyrics.py` and its pinned model revision. Full tracks were processed in bounded windows. Evaluation includes only hand-edited, active, non-ad-lib reference lines with an exact line-ID/text match and a returned candidate. Errors are absolute differences in line onset/end, not word-level phonetic accuracy. The manual-edit flag is a useful user reference, not independent certification that every boundary is correct.

## Results

All times in milliseconds. Each cell is **baseline → phoneme proposal** on the same paired lines. These are raw candidates before the application policy; rejected/colliding proposals are not being reported as already applied.

| Recording | Paired / manual active lines | Mean onset error | Median onset error | Mean end error | Median end error |
| --- | ---: | ---: | ---: | ---: | ---: |
| EPA streikt (newer reference) | 38 / 56 | 818 → 583 | 602 → 130 | 484 → **562** | 480 → 264 |
| Schwarzer Flur | 42 / 55 | 643 → **84** | 538 → 59 | 453 → **267** | 401 → 198 |
| Well of Youth, male singing (English) | 25 / 27 | 851 → **402** | 708 → 80 | 1138 → **900** | 781 → 882 |
| Mehr als Code, full song | 29 / 36 | 726 → **823** | 277 → 57 | 1828 → **1639** | 380 → 87 |

| Recording | Onsets within 200 ms | Ends within 200 ms | Onsets worse by >50 ms | Ends worse by >50 ms |
| --- | ---: | ---: | ---: | ---: |
| EPA | 8 → 23 / 38 | 8 → 14 / 38 | 9 / 38 | 11 / 38 |
| Schwarzer Flur | 9 → 36 / 42 | 6 → 21 / 42 | 1 / 42 | 5 / 42 |
| Well of Youth | 7 → 22 / 25 | 2 → 7 / 25 | 7 / 25 | 8 / 25 |
| Mehr als Code | 9 → 25 / 29 | 4 → 19 / 29 | 5 / 29 | 9 / 29 |

## Coverage and failures

Only **134 of 174** manually edited active canonical lines have comparable candidates. Excluding failures makes the paired metrics more favourable than whole-song automation coverage; the missing lines are part of the result, not successful alignments.

- EPA: 12 lines lost through windows with unsupported IPA `ʏ`; 6 lines have no candidate because the reconstructed textual alignment has no match.
- Schwarzer Flur: 12 lines lost through windows with unsupported IPA `ʊɐ`; 1 line has no candidate.
- Well of Youth: no IPA-symbol failures; 2 lines have no candidate.
- Mehr als Code: 3 lines lost through windows with unsupported IPA `ʏ`; 4 lines have no candidate.

An unsupported pronunciation currently rejects the entire window, including otherwise representable neighbouring lines. This deserves a focused tokenizer/fallback improvement. Unknown symbols must not silently be replaced with invented acoustic evidence. Composite pronunciation units should be checked against the model's actual token inventory before deciding whether lossless decomposition is possible.

The **13 reference-confirmed active lines without textual matches** are false negatives of the coarse matcher. Zero match confidence is consequently not enough to conclude that a lyric was not sung. Keeping omissions as reviewable proposals, and respecting explicit re-enabling, is necessary.

Examples of large remaining errors:

- EPA, “Meine Zeit geht drauf”: reference end 152.779 s; candidate end 156.454 s (3.675 s late).
- EPA, “Nur an Leere festhängt”: reference end 132.741 s; candidate end 136.184 s (3.443 s late).
- Well of Youth, “We find the light…”: reference onset 242.918 s; reconstructed baseline 247.820 s; candidate 250.040 s. The local refinement cannot repair an already misplaced coarse window reliably.
- Mehr als Code, “Ich bin mehr, als man mich nennt”: reference 156.892–159.564 s; baseline 161.610–174.550 s; candidate 170.510–176.850 s. A plausible forced path can fit the wrong passage.

## Consequences

The additional model is useful especially for onsets, with the strongest result on Schwarzer Flur. It is not yet a reliable fully automatic end detector. Median improvements alone conceal significant outliers; English endpoints still have a median error of 882 ms. There is no French recording in this library, so French singing accuracy remains untested.

The next accuracy work should target phoneme coverage, localisation of gross coarse-alignment failures, and end boundaries checked against independently reliable following onsets. Do not solve the end problem with a generic maximum note duration: that would damage genuinely sustained notes. Do not tune thresholds using the corrected times and then claim this same library as independent validation.

Local reproducibility artifacts:

- `.tmp/alignment-library-benchmark.ts`: reconstruction and model runner.
- `.tmp/alignment-library-benchmark/<song>/`: `baseline.json`, `reference.json`, model `input.json` / `output.json`, per-line `comparison.json`, and source hashes in `provenance.json`.
- `.tmp/alignment-library-benchmark/summary.json`: aggregate results.

The earlier twelve-line Mehr als Code result remains a valid small-sample measurement, but these full-song results provide the more representative picture of failure modes.
