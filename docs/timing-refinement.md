# Vocal timing refinement

Whisper still supplies the rough timing and text-presence evidence. An optional local phoneme pass refines that timing using `facebook/wav2vec2-lv-60-espeak-cv-ft`, pinned to revision `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`. This is multilingual speech alignment, not a singing-specialized model or a guarantee of lip sync.

In the Timing page, open **Refine timing from vocals**, choose German, English or French, and **Prepare refinement**. Save or discard existing edits first. The proposal lists old/new line bounds, provides listening buttons, and explains omissions or rejected results. **Apply proposal** saves the usable changes together; **Dismiss** leaves the timing alone. Newly refined words remain unchecked.

The CLI uses the same service:

```powershell
bun run timing <project-id> --refine=de
bun run timing <project-id> --apply-refinement=<proposal-id>
```

Use `--refine=en` or `--refine=fr` for those languages, and add `--json` for the full proposal. The language is selected explicitly: this does not detect code-switching within a song. German and one English recording have now been compared against hand-edited timing; French singing accuracy remains untested. See [the full-library results](alignment-library-results.md) and [the accepted direction and next experiments](alignment-next-steps.md).

Requires `uv`, Python 3.12 managed by uv, and `ffmpeg` on PATH. The first pass downloads dependencies and the model; subsequent passes reuse their caches. Inference runs locally on CPU. It processes windows of at most 30 seconds and loads the model once per run. Neighbouring lyrics provide context; unsupported pronunciations or collapsed word spans retain the original timing and appear for review. eSpeak sometimes merges English function words: in that case pronunciation falls back to separate source words to preserve their identities.

The pinned vocabulary accepts the explicitly evaluated eSpeak composite `ʊɐ` as
its existing `ʊ` and `ɐ` tokens when no native composite token exists. Native tokens
always take precedence. Other missing phones (including `ʏ`) remain errors; this
is not a general character splitter or an approximate pronunciation substitution.
Unsupported windows still retain their original timing. Isolating their valid
neighbours by cropping out the unsupported line remains experimental: that can
lose necessary context and misplace repeated lyrics.

Protection rules:

- Hand edits, word anchors, structural groups/joins, disabled lines and ad-libs are retained.
- A line with zero transcript-match confidence is proposed for omission, never silently forced into the audio. This is not proof that it was not sung; partially matched lines remain active. Explicitly re-enabling a line records your presence decision so a later pass does not omit it again.
- Long notes have no generic maximum word duration. A line may be shortened at an independently confirmed next onset only when both lines have the same single singer and no internal singer change. A second estimate from the same model is not a confirmed onset.
- Onset movements over three seconds, invalid words, excerpt-edge results and new same-singer collisions are withheld. Collisions between independently analysed windows may need a manual anchor before another pass.
- Applying a stale proposal fails if timing, singers, duration, stem reference or the stem file changed. Preparing a proposal does not change the song timing.

Applying updates clip vocals and invalidates affected shot plans through the existing timing save logic. Rebuild those plans to update video prompts. It does not recut the timeline or regenerate videos. The previous `lyricsTiming` object is saved under `.timing-refinement/before-<proposal-id>.json`; the latest proposal and candidate output are kept alongside it for diagnosis. These are local project artifacts, not a new pipeline cache stage. Existing projects and normal planning do not automatically download or run this experimental model.

The isolated-song test covered 14 lines from “Mehr als Code”: 10 refinement proposals, 2 proposed omissions and 2 withheld collisions. It reproduced the expected omissions and the held “Herz” ending at 83.82 seconds. A 96 ms collision between separate windows was rejected by policy. The known “Zahl” boundary remains inaccurate without a confirmed next onset: plausible model output still requires listening. The real project was not altered by this test.
