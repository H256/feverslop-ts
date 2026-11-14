# Lyrics alignment comparison implementation plan

Goal: compare current timing with WhisperX and Qwen without modifying source projects.

Architecture: a standalone Python CLI snapshots selected lyric lines and crops a shared audio window. Optional, isolated model environments produce separate JSON results. Mapping preserves missing words rather than interpolating them. Reports distinguish changes from accuracy against explicitly supplied reference lines.

Tasks:
- [x] Test ordered word mapping, crop offsets, missing words and reference-only scoring.
- [x] Implement prepare/run/report commands in tools/alignment_compare.py.
- [x] Prepare Verse 1 and Chorus examples from mehr-als-code-261112.
- [x] Run both aligners where dependencies and model downloads are available.
- [x] Document reproducible commands, results and limitations; never write production timings.

Validation: Python unittest; real preparation and model smoke tests; source project hash before/after. No production pipeline integration in this experiment.
