# IPA phoneme alignment experiment

Run after preparing excerpts with `tools/alignment_compare.py`:

```powershell
uv run --python 3.12 --with qwen-asr --with phonemizer --with espeakng-loader python tools/phoneme_compare.py .tmp/alignment-verse-wide
python tools/alignment_compare.py report .tmp/alignment-verse-wide --html --html-name review-ipa.html
python -m unittest discover -s tools -p 'test_*compare.py'
```

`qwen-asr` reuses the existing experiment dependency stack (torch/transformers); this program does not load or run Qwen. CPU only. First execution downloads the Facebook model. Local source audio is not uploaded.

Method: eSpeak converts each complete lyric line into phonemes while retaining word separators. The multilingual `facebook/wav2vec2-lv-60-espeak-cv-ft` acoustic model produces phone probabilities every 20 ms. A CTC Viterbi path aligns the known phone sequence across the whole excerpt. It is not restricted to existing word boxes. Word boundaries are the first/last phone spans. Unsupported phone symbols or changed G2P word counts fail explicitly rather than silently substituting or interpolating.

Two outputs preserve the distinction between acoustic alignment and heuristic adjustment:

- `ipa-raw.json`: raw non-blank phone spans.
- `ipa.json`: additionally distributes gaps of at most 300 ms between adjacent phones (40% to previous, 60% to next). Longer pauses remain untouched. This is an experimental heuristic, not a guarantee of complete vowel tails.

Phones and their mean log probability, source model revision, dependency versions, words and baseline differences are stored. Scores are not calibrated confidence. CTC forces the supplied sequence and cannot establish whether a lyric was actually sung. The omitted-intro excerpt remains a deliberate stress case.

The language probe checks eSpeak pronunciation generation in German, English and French. It does NOT establish alignment quality on English/French singing: that requires audio and confirmed references in those languages. French liaison/elision and changes in word count are particularly important to inspect.

This is an independent minimal implementation of the IPA/CTC approach, not a reproduction of the upstream benchmark or its singing fine-tuning, spectral-flux refinement, or phone fallback rules. Do not attach the upstream accuracy claims to these outputs.

Sources:
- https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft
- https://github.com/gillosae/phoneme-conditional-singing-analysis/blob/main/benchmark/README.md
- https://github.com/thewh1teagle/espeakng-loader

## Executed results (2026-11-13)

All three German excerpts completed on CPU. Model revision: `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`; torch 2.15.0, phonemizer 3.6.0, espeakng-loader 0.2.4. `review-ipa.html` in each experiment compares all five variants, including raw and adjusted IPA.

| Line | IPA start | IPA end |
|---|---:|---:|
| Aus kaltem Licht, aus kalter Zahl | 35.640 | 41.088 |
| Erwacht im Netz brennende Qual | 41.088 | 46.376 |
| Ich fühl mein Blut in binärer Haut | 46.376 | 50.620 |
| Die Stille schreit, die Welt wird laut | 51.060 | 56.500 |
| Lyra, Lyra, ich bin mehr | 70.340 | 72.856 |
| Als Code, als Licht, als leeres Meer | 72.856 | 75.484 |
| Lyra, Lyra, hat ein Herz! | 78.408 | 83.820 |

These are predictions, not validated boundaries. IPA avoids WhisperX's 68.000 chorus onset and Qwen's zero-duration “Meer”, but the end of “Herz” still runs almost to the 84 s crop boundary. “Zahl” extends to the following phrase. Without human reference boundaries this is not a measured accuracy improvement.

The absent-intro stress case fails: both nonexistent lines are squeezed into 35.400–35.940, displacing the following real line. A forced phone path cannot itself establish text presence. Omission handling must precede or constrain alignment.

DE/EN/FR pronunciation generation ran successfully. However, the English probe merges the word separators of “in the”; the current strict word-count check would reject a passage with this grouping. Thus multilingual pronunciation is verified, but robust word mapping in all three languages is NOT complete. Preserve explicit word ownership or implement a tested separator reconciliation before English/French audio evaluation; do not silently map by index.

Eight unit tests pass; source project SHA256 remained unchanged. No listening-based ground truth, English/French singing evaluation, or production integration was performed. This experiment tests the base IPA model, not SOFA, nor the exact upstream benchmark implementation.
