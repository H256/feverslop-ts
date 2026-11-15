# Vocal timing refinement

Whisper still supplies the rough timing and text-presence evidence. An optional local phoneme pass refines that timing using `facebook/wav2vec2-lv-60-espeak-cv-ft`, pinned to revision `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`. This is multilingual speech alignment, not a singing-specialized model or a guarantee of lip sync.

In the Timing page, open **Refine timing from vocals**, choose German, English or French, and **Prepare refinement**. Save or discard existing edits first. The proposal lists old/new line bounds, provides listening buttons, and explains missing evidence or rejected results. **Apply proposal** saves the usable timing changes together; **Dismiss** leaves the timing alone. Newly refined words remain unchecked. Applying refinement never leaves lines out.

The CLI uses the same service:

```powershell
bun run timing <project-id> --refine=de
bun run timing <project-id> --apply-refinement=<proposal-id>
```

Use `--refine=en` or `--refine=fr` for those languages, and add `--json` for the full proposal. The language is selected explicitly: this does not detect code-switching within a song. German and one English recording have now been compared against hand-edited timing; French singing accuracy remains untested. See [the full-library results](alignment-library-results.md) and [the accepted direction and next experiments](alignment-next-steps.md).

## Retry a confirmed sung passage

Select a canonical lyric line and choose **Retry sung passage**. Confirm that the text really is sung and choose its language. This prepares one bounded excerpt with the selected line, up to three preceding and two following known/confirmed sung lines as context. It proposes timing changes only for the selected line and its immediate eligible following line. The rest of the song is not repartitioned or retimed.

Use **Listen before** and **Listen to proposal**, then **Apply passage** to save both proposed lines together. Only applying a usable passage confirms the selected line's presence and re-enables it if it was left out. Dismissing or failing preparation changes nothing. The words remain unchecked; confirming presence does not mark timing as manually reviewed. If either editable line fails validation, neither is applied. Protected following lines serve as context only.

```powershell
# One-based line numbers as printed by the timing command:
bun run timing <project-id> --refine=de --refine-line=15 --confirm-sung
bun run timing <project-id> --apply-refinement=<proposal-id>
```

The passage must fit within 30 seconds. Hand-timed, anchored, grouped/joined targets and ad-libs cannot use this retry; keep or explicitly reset manual work first. This does not infer whether unknown lyrics were sung. Confirming absent text can force invented word timings and displace real words. Missing words must first be added in the editor.

Isolated service test on “Flimmernder Hof”: “Sagst ganz leise” moved from 28.780–29.780 to 29.562–31.078 seconds; the following “Es” onset moved from 29.660 to 31.078. The full prepare/apply path changed only these two lyric lines, saved the original timing backup and left the source project unchanged. Preparation took 12.86 seconds on the test machine with cached dependencies/model; this is a single-excerpt measurement, not a general latency guarantee.

Requires `uv`, Python 3.12 managed by uv, and `ffmpeg` on PATH. The first pass downloads dependencies and the model; subsequent passes reuse their caches. Inference runs locally on CPU. It processes windows of at most 30 seconds and loads the model once per run. Neighbouring lyrics provide context; unsupported pronunciations or collapsed word spans retain the original timing and appear for review. eSpeak sometimes merges English function words: in that case pronunciation falls back to separate source words to preserve their identities.

The pinned vocabulary accepts the explicitly evaluated eSpeak composite `ʊɐ` as
its existing `ʊ` and `ɐ` tokens when no native composite token exists. Native tokens
always take precedence. Other missing phones (including `ʏ`) remain errors; this
is not a general character splitter or an approximate pronunciation substitution.
Unsupported windows still retain their original timing. Isolating their valid
neighbours by cropping out the unsupported line remains experimental: that can
lose necessary context and misplace repeated lyrics.

Protection rules:

- Hand edits, word anchors, structural groups/joins and ad-libs are retained. Disabled lines remain disabled except for the explicitly confirmed target when applying a passage.
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
