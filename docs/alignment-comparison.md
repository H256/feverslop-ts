# Local lyrics alignment comparison

This experiment never updates project.json, lyrics, clips, or prompts. It reads a project once and creates a new directory containing a 16 kHz mono vocal excerpt and a baseline snapshot. Output directories and result files cannot be overwritten. Backends run separately to avoid dependency conflicts.

## Run

```powershell
python tools/alignment_compare.py prepare E:/workspace/typescript/storymaker/projects/mehr-als-code-261112 .tmp/alignment-verse --lines 2,3,4,5 --start 34 --end 55
uv run --python 3.12 --with whisperx python tools/alignment_compare.py run .tmp/alignment-verse --backend whisperx --device cpu
uv run --python 3.12 --with qwen-asr python tools/alignment_compare.py run .tmp/alignment-verse --backend qwen --device cpu
python tools/alignment_compare.py report .tmp/alignment-verse
python -m unittest discover -s tools -p test_alignment_compare.py
```

Add `--html` to `report` to create `review.html` next to the excerpt. Open it in a browser to hear baseline and candidate spans, optionally with 0.6 seconds context. Playback stopping uses browser media events and is for qualitative listening, not sample-accurate measurement. The page does not save or modify any timing.

Line IDs are zero-based stored IDs. Choose adjacent lines and a window with context, including their complete vocal tails. Do not treat existing line boundaries as crop boundaries. Default execution is CPU to avoid competing with video renders; CUDA is optional. First execution downloads packages and model weights. Audio stays local.

Each backend aligns the concatenated text across the entire excerpt. Results contain raw backend words in excerpt time, mapped words in absolute song time, package version, runtime, and changes relative to the baseline. Exact normalized sequence matching maps words back to line IDs; unmatched words remain null. Tokenization mismatches therefore require inspection and are not silently interpolated. Complete alignment is NOT evidence that text was actually sung: forced aligners may place absent lyrics.

## Evaluate

Baseline differences are not accuracy. Supply a separate JSON array with manually confirmed boundaries to score:

```json
[{"line": 2, "start": 35.2, "end": 39.9}]
```

These numbers are illustrative, not measurements. Use `report ... --reference reference.json`. Metrics report median/max absolute boundary error and fractions within 50/100/200 ms; missing predictions count against those fractions. Only supplied reference boundaries are scored. Preserve source timings while listening and recording references. Compare line starts, sustained endings, adjacent-line transitions, omitted lyrics, then words near cuts. A filled timestamp alone must never count as successful detection of an omitted line.

Current scope: baseline snapshot plus two candidate aligners and JSON comparison. No automatic omission detection, production integration, UI editing, or claim of a winning model. Source project hashes are recorded so later changes can be distinguished from the snapshot. Model revisions are not pinned yet; package versions are recorded, and a selected production backend will need a lockfile and fixed model revision.

## Primary API sources

- https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py
- https://github.com/QwenLM/Qwen3-ASR#forcedaligner-usage
