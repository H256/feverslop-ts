# Vocal timing refinement

Whisper still supplies the rough timing and text-presence evidence. An optional local phoneme pass refines that timing using `facebook/wav2vec2-lv-60-espeak-cv-ft`, pinned to revision `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`. This is multilingual speech alignment, not a singing-specialized model or a guarantee of lip sync.

In the Timing page, open **Refine timing from vocals**, choose German, English or French, and **Prepare refinement**. Save or discard existing edits first. The proposal lists old/new line bounds, provides listening buttons, and explains missing evidence or rejected results. **Apply proposal** saves the usable timing changes together; **Dismiss** leaves the timing alone. Newly refined words remain unchecked. Applying refinement never leaves lines out.

The CLI uses the same service:

```powershell
bun run timing <project-id> --refine=de
bun run timing <project-id> --apply-refinement=<proposal-id>
```

Use `--refine=en` or `--refine=fr` for those languages, and add `--json` for the full proposal. The language is selected explicitly: this does not detect code-switching within a song. German and one English recording have now been compared against hand-edited timing; French singing accuracy remains untested. See [the full-library results](alignment-library-results.md) and [the accepted direction and next experiments](alignment-next-steps.md).

## Taking a proposal line by line

A prepared proposal is drawn on the timeline: choose a line and its proposed words appear as a green lane under the real words, on the same waveform, with a dashed line up to where each proposed word starts. A line the refinement could not place shows why in the bar above the editor, in yellow. Click a proposed word to hear it; **▶ Now** and **▶ Proposal** play the whole line, as it is and as proposed.

**Take** (Enter) applies that line only and goes on to the next one with a proposal; **Keep mine** (X) leaves it as it is and goes on; `[` and `]` step back and forth. **Take all** applies everything left. Taking one line keeps the rest of the proposal valid. A line is refused when it would run into a neighbour of the same singer that keeps its times: take both, or move one by hand. The timing from before the proposal is saved once, under the first line taken. Pending edits must be saved first, as with the whole proposal.

```powershell
bun run timing <project-id> --apply-refinement=<proposal-id> --lines=3,5
```

## Retry a confirmed sung passage

### Refine words after roughly placing a block

Move/resize the lyric block to the part of the vocals where it is sung, then choose **Refine words in block**. With unsaved edits the action reads **Save changes & refine words**: the confirmation explicitly saves pending timing edits first, then prepares a separate proposal. If preparation fails, the saved rough placement remains. **Apply word refinement** replaces only the selected line's word boundaries; dismissing keeps the saved rough placement.

This mode accepts a line previously moved by hand without resetting its timing. Its saved start/end define the exact audio window (up to 30 seconds); only that line's text is aligned. Words may move inward to detected singing but never outside those bounds. Neighbouring lines remain untouched. Individual word anchors and structural groups/joins still require an explicit edit before replacement. Whole-song refinement continues to protect manually placed lines. Final small word corrections can be made normally after applying.

```powershell
bun run timing <project-id> --refine=de --refine-line=15 --confirm-sung --within-block
bun run timing <project-id> --apply-refinement=<proposal-id>
```

The bounded mode assumes the complete lyric line fits inside the block. It cannot recover singing cropped out by a wrongly placed start/end. It is a time constraint, not a promise of millisecond accuracy. In an isolated CPU test, a manually saved 29.500–31.100 s block for “Sagst ganz leise” yielded words at 29.580–30.040, 30.040–30.472 and 30.472–31.000 s in 13.51 seconds with cached dependencies. Only the selected line changed; the user's source project was not modified.

### Retry missing context together with the following line

Select a canonical lyric line and choose **Retry sung passage**. Confirm that the text really is sung and choose its language. This prepares one bounded excerpt with the selected line, up to three preceding and two following known/confirmed sung lines as context. It proposes timing changes only for the selected line and its immediate eligible following line. The rest of the song is not repartitioned or retimed.

Use **Listen before** and **Listen to proposal**, then **Apply passage** to save both proposed lines together. Only applying a usable passage confirms the selected line's presence and re-enables it if it was left out. Dismissing or failing preparation changes nothing. The words remain unchecked; confirming presence does not mark timing as manually reviewed. If either editable line fails validation, neither is applied. Protected following lines serve as context only.

```powershell
# One-based line numbers as printed by the timing command:
bun run timing <project-id> --refine=de --refine-line=15 --confirm-sung
bun run timing <project-id> --apply-refinement=<proposal-id>
```

The passage must fit within 30 seconds. Hand-timed targets should use **Refine words in block** instead; this context retry still protects hand edits, anchors, groups/joins and ad-libs. This does not infer whether unknown lyrics were sung. Confirming absent text can force invented word timings and displace real words. Missing words must first be added in the editor.

Isolated service test on “Flimmernder Hof”: “Sagst ganz leise” moved from 28.780–29.780 to 29.562–31.078 seconds; the following “Es” onset moved from 29.660 to 31.078. The full prepare/apply path changed only these two lyric lines, saved the original timing backup and left the source project unchanged. Preparation took 12.86 seconds on the test machine with cached dependencies/model; this is a single-excerpt measurement, not a general latency guarantee.

Requires `uv`, Python 3.12 managed by uv, and `ffmpeg` on PATH. The first pass downloads dependencies and the model; subsequent passes reuse their caches. Inference runs locally on CPU. It processes windows of at most 30 seconds and loads the model once per run. Neighbouring lyrics provide context; unsupported pronunciations or collapsed word spans retain the original timing and appear for review. eSpeak sometimes merges English function words: in that case pronunciation falls back to separate source words to preserve their identities.

Model progress and diagnostics stream to the project's `logs/timing-refinement/<run-id>.log`, not the editor terminal. The proposal/CLI output shows the log path. Failures still report the diagnostic tail. Logs are scoped per operation (safe for concurrent projects) and the latest 20 are retained in this subfolder, so they do not replace the pipeline's latest-run log.

The pinned vocabulary accepts the explicitly evaluated eSpeak composite `ʊɐ` as
its existing `ʊ` and `ɐ` tokens when no native composite token exists. Native tokens
always take precedence. Other missing phones (including `ʏ`) remain errors; this
is not a general character splitter or an approximate pronunciation substitution.
Unsupported windows still retain their original timing. Isolating their valid
neighbours by cropping out the unsupported line remains experimental: that can
lose necessary context and misplace repeated lyrics.

Protection rules:

- Whole-song and context-passage refinement retain hand edits, word anchors, structural groups/joins and ad-libs. The explicit within-block action may replace the selected line's manual timing; anchors/groups/joins remain protected. Disabled lines remain disabled except for the explicitly confirmed target when applying a passage.
- Whole-song refinement marks a line with zero transcript-match confidence for manual review; its timing and sung/left-out state remain unchanged. Missing text evidence is not proof that it was not sung. Leave out lines explicitly after listening, using the normal editor/CLI action. Older saved proposals containing automatic presence changes must be prepared again. Explicitly re-enabling a line or applying a confirmed passage records your presence decision and allows it to be considered for alignment.
- Long notes have no generic maximum word duration. A line may be shortened at an independently confirmed next onset only when both lines have the same single singer and no internal singer change. A second estimate from the same model is not a confirmed onset.
- Onset movements over three seconds, invalid words, excerpt-edge results and new same-singer collisions are withheld. Collisions between independently analysed windows may need a manual anchor before another pass.
- Unmatched, unconfirmed placeholder spans remain visible for correction, but are not reliable collision anchors. Manual timing, word anchors and explicit presence decisions still participate in collision protection. This does not make uncertain neighbouring timing acoustically correct.
- Applying a stale proposal fails if timing, singers, duration, stem reference or the stem file changed. Preparing a proposal does not change the song timing.

Applying updates clip vocals and invalidates affected shot plans through the existing timing save logic. Rebuild those plans to update video prompts. It does not recut the timeline or regenerate videos. The previous `lyricsTiming` object is saved under `.timing-refinement/before-<proposal-id>.json`; the latest proposal and candidate output are kept alongside it for diagnosis. These are local project artifacts, not a new pipeline cache stage. Existing projects and normal planning do not automatically download or run this experimental model.

Historical baseline test, before the presence-preserving fix: 14 lines from “Mehr als Code” yielded 10 refinements, 2 omissions and 2 withheld collisions. The omission behavior has been removed. The held “Herz” ended at 83.82 seconds; a 96 ms collision between separate windows was rejected. The known “Zahl” boundary remains inaccurate without a confirmed next onset: plausible model output still requires listening.

Regression replay on “Flimmernder Hof” reused the saved pre-apply timing and raw
candidate output, without running inference or writing the project. Previously:
35 refined, 18 omitted, 11 review. After the fix: the exact same 35 timing changes,
29 review, zero presence changes. This preserves useful candidates rather than
rolling all timing back. It does not repair inaccurate word boundaries. Already
applied omissions remain until explicitly re-enabled; no automatic recovery or
reset of later user edits occurs. In particular, the missing “Sagst ganz leise”
was absent from model input, not acoustically determined to be unsung.
