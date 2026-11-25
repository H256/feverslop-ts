# Shot prompt and take-check rules: what we already do

Issue #1196 listed nine rules from a review of another H3 production tool. This page checks each one against our pipeline
(as of 2026-11-25) and says what is left.

| # | Rule | Status | Where |
|---|------|--------|-------|
| 1 | A place card per viewing direction; the place picture goes to every shot there | **Done** | Location sheets with views, the view of each shot chosen from them (`lib/film/views.ts`, designed views in `lib/film/compose.ts`), stage places per band member (#1189), `bun run add-view` for further views |
| 2 | Every prompt restates time of day, light, palette, lens and wardrobe | **Done, differently** | The film look goes into every clip prompt. Wardrobe comes from the cast picture plus `retention_analysis` (`fully_preserved`), place pictures carry time of day, weather and light (`lib/prompts.ts`). Scenes track time of day in `begins` (`lib/film/prompts.ts`) |
| 3 | Several faces: say who sings or speaks, the others keep their mouths closed | **Done** | `singing: yes/no` per person and "lips together" for everyone else (`lib/shot-planner.ts`, `lib/shot-plan.ts`, `lib/compose.ts`); film: "nobody but the speaker moves their mouth" (`lib/film/compose.ts`) |
| 4 | Everyone visible is in the shot's cast, background included | **Done** | Shot cast and group characters (`lib/compose.ts`, `compose-shot-cast` tests), crowd view check (`lib/crowd-view-check.ts`) |
| 5 | Signs, screens and labels are wordless; words go in an overlay | **Done** | Shot planner: nothing in the picture is readable text (`lib/shot-planner.ts`); film: no text that must be readable (`lib/film/prompts.ts`); reference pictures: no text or lettering (`lib/prompts.ts`) |
| 6 | Ghosting check: faces at start, middle and end; doubled or see-through features fail the take | **Gap** | Clip QA measures black, frozen and unplanned cuts only (`lib/clip-qa.ts`). The known cause of one ghost (the start frame also given as a reference) is fixed in `lib/compose.ts`, but nothing detects a doubled face in a take |
| 7 | At most two retakes for the same fault, then change the approach | **Not applicable** | We retake automatically only on black or frozen pictures. Every other retake is the user's choice |
| 8 | A master says plainly who it shows first; check it before shots depend on it | **Done** | Role states the gender ("a young woman who ...", `lib/prompts.ts`), gender check (`lib/gender-check.ts`), reference plates are clean, sharp and in the film look (`lib/prompts.ts`) |
| 9 | Wide or from-behind shots get no driving audio | **Open question** | Our view: a wide shot looks dead when nothing moves in the face. It needs an A/B test before any change |

## Not adopted

"Never write the sung words in the prompt." We write the timed sung words into the prompt, and lip sync got clearly better
once the song timing was right. That contradicts the rule, so we keep ours.

## Follow-ups

- Rule 6: detect doubled or see-through faces in a take (#1199).
- Rule 9: A/B test of a wide singing shot with and without driving audio (in the test plan of #1199, or its
  own when someone picks it up).
