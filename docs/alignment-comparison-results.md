# First local alignment comparison — 2026-11-13

Source: mehr-als-code-261112. Existing saved timings are a baseline, NOT manually confirmed ground truth. All timings below are absolute song seconds. No production files were modified. CPU inference used whisperx 3.8.6 (German default VoxPopuli alignment model) and qwen-asr 0.0.6 (Qwen/Qwen3-ForcedAligner-0.6B).

## Completed experiments

- `.tmp/alignment-verse-wide`: lines 2–5, audio 34–57 s. Use this instead of the initial 34–55 s experiment, whose final line could be clipped.
- `.tmp/alignment-chorus`: lines 10–13, audio 68–84 s.
- `.tmp/alignment-omitted`: lines 0–3, audio 30–45 s. This probes absent intro lyrics; the last neighboring line's tail is not a complete reference in this window.

Each directory has manifest.json, audio.wav, whisperx.json, qwen.json and review.html (except the superseded short verse run, which has no HTML). JSON preserves raw outputs, mapped words, baseline deltas, package version and elapsed runtime including initial loading/downloading. Local media/results are gitignored.

## Observations, not accuracy claims

| Boundary | Baseline | WhisperX | Qwen |
|---|---:|---:|---:|
| “Aus kaltem Licht … Zahl” start | 35.420 | 35.721 | 35.440 |
| Same line end | 39.270 | 41.146 | 39.920 |
| “… brennende Qual” end | 43.395 | 46.491 | 46.080 |
| “… binärer Haut” end | 50.340 | 51.135 | 50.640 |
| “Die Stille …” start | 50.340 | 51.175 | 51.040 |
| “Lyra, Lyra, ich bin mehr” start | 70.600 | 68.000 | 70.240 |
| Same line end | 72.520 | 72.886 | 72.160 |

WhisperX puts the first chorus word at the excerpt's beginning: a suspicious boundary, not evidence of the correct onset. Qwen returns zero duration for “Meer” and some other chorus words; these are explicitly unmapped, not repaired by interpolation. It also extends the final “Herz” to 83.840. That needs listening validation rather than automatic acceptance.

The user identified the intro lyrics as absent. WhisperX nevertheless supplies spans for both intro lines. Qwen also places parts of them and corrupts the following assignment. Neither backend alone is a reliable omission detector in this experiment.

## Decision

Do not switch the production aligner yet. Both candidates run locally, but both show failure cases. Next: listen to review.html, record confirmed line boundaries separately, then score with `--reference`. Test a text-consistent context window (neighboring sung material in the padding must be represented) and an explicit omitted-line variant. Preserve the absent-text stress test. Compare on two further songs before selecting a production backend.

Five unit tests pass: offset restoration/missing middle word, repeated words, missing edge boundaries, missing-prediction penalty, and no accuracy claims without references. All real backend runs completed. HTML generation succeeded; interactive browser playback has not been verified in this turn.
