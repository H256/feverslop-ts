# Correcting lyric timing

The timing editor places lyric words over the audible vocals. Correct the passage first; resolve any remaining clip cuts inside words afterwards. Saving timing does not move existing video clip boundaries or render videos automatically.

## Fast correction

- Click a word, Shift-click another to select a range. Shift-click line rows to select several lines. Shift-drag the exposed lower waveform to select the words in a time range.
- Drag a word selection or the selection bar to move it together, preserving its gaps. Drag the line's top bar to move the complete line. Arrow keys move the selection by 0.05 seconds; Shift increases the step to 0.5 seconds.
- Drag the edges of the selection bar to fit its duration, or open **Fit, split and shared boundary** and set two endpoints. **Listen to fit** plays the passage; **I** and **O** capture the start and end at the audio cursor. **Preview fit** shows the provisional times before **Apply fit**.
- **Anchor onsets** protects selected starts during fitting. Release an anchor before moving that endpoint. Deliberately translating the selection moves its anchors with it.
- A single word stops at its neighbors. Shift-drag a word edge to adjust a shared boundary explicitly. Snapping is optional; hold Alt to bypass it. The viewport stays fixed during a drag.

Inferred times remain unchecked. **Mark reviewed** explicitly confirms selected positions. Editing or grouping a passage alone does not confirm its timing. Use **Next unchecked** and **Next cut** to navigate the two kinds of work separately.

## Mark while listening

Select the passage and open **Listen and mark onsets**. **Start marking** begins with pre-roll; **Mark from cursor** starts from where you have been listening, useful when the old alignment is far away.

Press **M** once at each word onset. The next word is named above the restart buttons. After all onsets, press **M** once more or **Final end** at the last word's end. Space pauses/resumes; Backspace retracts one mark. Restart buttons keep earlier marks and replay from the chosen word. Speed and looping are optional audition controls.

Set a reaction offset in milliseconds to shift all recorded marks earlier, then **Apply marks**. The operation is one undo step. Interior word ends are inferred from the following onset, so pauses and held notes may still need adjustment; these times remain unchecked.

## Groups and word parts

**Group selection** preserves each word and its times. Collapse the group to move it as a single block; expand or ungroup to edit its words again. A temporary selection is sufficient for a one-off move.

When a fixed clip boundary crosses a word, select that word and choose its text boundary in **Fit, split and shared boundary**. The split time defaults to a crossing clip boundary when one exists. The text boundary and time are independent. Listen around the split, then apply it. For example, `Rosma|rienbaum.` retains the full source text and outer time range. **Join parts** restores consecutive parts of the same source word, including after saving and reloading. A join across an assigned singer change is refused, so a syllable cannot silently change singers.

The **Clip text and windows** preview shows saved and draft clip text. A continued word produces `Rosma-` in one clip and `-rienbaum.` in the next; source lyrics are unchanged. Preview windows include 0.2 seconds of prompt padding. Singer-specific delivery and shot planning still happen in the plan stage.

Undo/Redo work on complete actions (Ctrl+Z / Ctrl+Shift+Z, or the buttons). Saving remains separate from planning. Anchors, groups and review flags alone do not invalidate shot plans. Changing audible timing or word parts can invalidate affected plans and rendered clips. Local movement of a video clip boundary is a separate follow-up.
