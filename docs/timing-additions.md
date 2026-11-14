# Missing sung words and ad-libs

On the Timing page, select a line and choose **Add words**. **Current line** inserts word boxes before a chosen word or after the last word. **New separate line in this section** adds a complete sung segment. Enter the missing text and its start/end in seconds. Multiple new words are initially spaced evenly and remain unchecked; their individual boundaries still need listening and adjustment. Existing words are not shifted or shortened. Save pending movements before adding words.

The save updates both `project.json` and `input/lyrics.txt`. Extending an ad-lib promotes it into a normal lyric line and enables it. New lyric lines require canonical line IDs to change: the timing, singers and clip vocals are remapped together, and existing shot plans are invalidated. Rebuild those plans before rendering. An insertion into an existing regular line only invalidates the affected clip plans. There is no automatic Whisper rerun or loss of existing hand timing.

Before either file is replaced, the original project and lyrics are stored together in `.timing-lyrics-backups/<id>.json`. Ordinary write errors roll the lyrics back. Each individual file is replaced atomically; the backup also supports recovery if the process crashes between the two replacements. External lyric changes or stale word timings reject an insertion instead of overwriting them.

Ad-libs have their own filter and explicit **off/sung** state. **Sing it** enables one. When there are pending timing changes, **Save changes & Sing it** saves and enables in one request instead of disabling the button. This does not turn the unchanged ad-lib into a canonical lyric line; it remains an accepted extra vocal. Adding missing words to it does promote it.

Omitted neighbouring lines stay visible as crossed-out context, but no longer intercept mouse dragging or contribute snap targets. To edit an omitted line deliberately, select it in the line list first. Selected editable word boxes appear above neighbouring boxes.

The CLI supports the same actions through `bun run timing <project> --set=change.json`. A new line needs no existing-word snapshot:

```json
{
  "lines": [],
  "add": {
    "afterLine": 33,
    "expectedText": "The currently selected line's exact text",
    "words": [{"text": "Oh", "start": 228.8, "end": 229.3, "estimated": true}]
  }
}
```

IDs in JSON are zero-based. For insertion into an existing line use `lines: [{line, insert: {at, expected, words}}]`: `at` is the zero-based insertion position, `expected` is the complete current word array from `--json`, and `words` are the added words with times. `off: false` also enables the line. To enable an ad-lib alone, `--on=<one-based line number>` continues to work.

A later library export includes the expanded lyric text and all word timings. Existing library entries are immutable; export the updated version under a new song ID. The original “Mehr als Code - Lyra” reference in the main checkout has not been changed.
