# Direction after planning

Direction changes how an existing scene is played and filmed. Start with a planned project; no direction is required when creating it. The story, cast, reference looks, audio, dialogue and cut timing stay in place.

The original instruction is saved separately from generated shots. An edit-specific LLM call turns it into a proposal for the structured shot plan. It does not append competing sentences to a video prompt. The normal composition code builds the video prompt from the accepted plan.

## CLI first

```powershell
bun run direction demo
bun run direction demo --add="Mara dances occasionally in suitable instrumental passages" --scope=character:mara
bun run direction demo --preview
bun run direction demo --json
bun run direction demo --take

# The same in one call: save, preview, take.
bun run direction demo --add="Mara dances in place" --scope=shot:b3:shot2 --preview --take

# Who is in a shot and what each of them does, as the plan has it now.
bun run direction demo --show=b3:shot2
```

Saving a rule does not render or change the accepted performance. Preview asks the LLM; taking accepts the reviewed changes and builds the clip prompts again (the normal planning run, `bun index.ts demo` or `bun film.ts demo`; `--no-rebuild` leaves that out). Then render stale clips in the workspace or select clips with `--render=videos --only=...`. Old renders remain available.

## Direct edits

Some choices need no language model: take a person out of a shot, or set its size. They change the plan directly and build the clip prompts again at once.

```powershell
bun run direction demo --without=kael --scope=shot:b3:shot2
bun run direction demo --without=kael --scope=beat:b3
bun run direction demo --size=close --scope=shot:b3:shot2   # wide, medium, close or extreme
bun run direction demo --unedit=<edit-id>
```

An edit applies to every shot its scope selects, like a rule. Whoever sings or plays in a shot - in a film, whoever speaks in it - is not taken out of it; the edit says so and leaves them. When the shot's words still name the person taken out ("{Kael} looks on"), the edit lists it and the next `--preview` gets a rule to write the shot without them: the code decides who is in the picture, the language model only rewrites the words.

Edits are kept apart from the plan. When the shots are planned again, the planner is told about them ("in shot 2, Kael is not in the picture") and the code enforces them on the new plan as well. An edit for a beat, a scene, a character, a time range or the project keeps applying; an edit for one shot waits to be bound again, like a shot rule, since a new plan has other shots.

Use `--film` for a film and `bun film.ts demo` for its normal planning run. Song time ranges belong to music projects only.

```powershell
# Read the actual shot IDs, scopes, proposal and versions as JSON.
bun run direction demo --json

# Exact movement in one existing shot (beat ID and shot number from the list).
bun run direction demo --add="Kael turns toward his own left until his back faces the camera" --scope=shot:b3:shot2

# Restrict a song interval to one character. Whole shots intersecting [42,55) are selected; the cut is not split.
bun run direction demo --add="Shifts weight from one leg to the other while dancing" --scope=time:42-55 --character=kael

# Edit a saved rule; explicitly specifying the scope rebinds it to the current source.
bun run direction demo --edit=<rule-id> --text="Small, restrained steps"
bun run direction demo --edit=<rule-id> --scope=shot:b3:shot2
bun run direction demo --remove=<rule-id>

# Export/import and restore. --set consumes the rules from the JSON, not its generated proposal/history.
bun run direction demo --json > direction.json
bun run direction demo --set=direction.json
bun run direction demo --restore=<version-id>
```

For JSON authored by hand, the minimum form is:

```json
{"rules":[{"id":"dance","text":"Kael dances occasionally","scope":{"kind":"global"},"characterId":"kael"}]}
```

Other scopes are `{"kind":"character","id":"kael"}`, `{"kind":"beat","id":"b3"}`, `{"kind":"scene","id":"s3"}`, `{"kind":"shot","id":"b3:shot2"}` and `{"kind":"time","start":42,"end":55}`. Saved scene/beat/shot rules have a generated `binding`: keep it when changing text; omit it only when explicitly assigning the rule to the current source. `--character=` clears an additional character filter when editing a rule.

## What to say

- Movement: “Kael turns toward his own left instead of right.” State whose left is meant; the character's left and screen-left are different.
- End pose: “Kael turns away until his back faces the camera.” This is more precise than “turns completely around”, which could describe a full revolution.
- Performance: “Mara dances in place, shifting her weight from one leg to the other with small sideways steps.”
- Camera: “Close-up of the fretting hand and guitar neck during the solo; the face is out of frame.” This changes the picture, not the song: it cannot add a guitar solo to the audio.

A local edit preserves the number and duration of shots. A broader instruction may select several existing shots, and the proposal shows that selection before acceptance. A change requiring new shots, a different cut, new characters or new dialogue belongs in planning rather than a local edit.

When rebuilding requests, automatic background-view selection uses the accepted direction and reselects changed shots. This may require a further LLM call; existing reference images are reused. A fixed music background view remains fixed by project configuration.

## Scope and precedence

Rules can apply to the project, a character, a beat (music), a scene (film), a song time range (music), or one shot. The command lists the actual shot and group IDs; use those rather than guessing an ordinal from a clip's label. A character filter can narrow another scope.

Compatible instructions combine. A specific instruction replaces contradictory general details: “dances” replaces “stands still”, while compatible singing and camera details stay. Shot instructions have precedence over group/time instructions, which have precedence over character and global instructions. Equal-priority contradictions must be resolved in the rules before a conflicting proposal can be taken.

The LLM sees existing shots and relevant context. It must align action, movement, camera and pose and report continuity conflicts instead of quietly changing an unrelated scene. No-thinking editing reduces unnecessary reasoning for local changes; actual latency depends on the model and amount of affected context. A structurally valid plan still cannot guarantee that a video model executes every motion exactly.

## Replanning and versions

Broad intent survives regenerated shots. When the source plan changes, review a fresh proposal before rendering from it. Scene and shot bindings include the source they were chosen from: a reused ID is not permission to apply an old instruction to a different scene. Missing or changed bindings are reported for explicit reassignment.

A proposal also records its source plan and rules. If either changed while reviewing, taking the old proposal is refused. Generate another preview.

Removing an instruction removes the requirement; it is not an undo of an accepted performance. Use a saved plan version to restore an earlier result. Restoring a plan does not overwrite rendered videos, and a version from an incompatible source plan cannot be restored onto a newly generated cut.

## Workspace

**Direct this shot** in the timeline's Shots panel opens one shot in a dialog: who is in it and what each of them does (start, in frame, movement, and whether they sing, play or speak). There you set the shot size or take a person out of the shot (direct edits, the clip prompts are built again at once), write an instruction for the shot or for one person in it, and **Propose** - saved and asked in one step. The proposal shows only the fields that change, before and after; **Take and build the prompts** takes it and builds the clip prompts again.

For rules and direct edits over several shots, open **Direction** in a project's navigation. Its **Direct edits** section takes a person out of every shot of a beat, a scene, a time range or every shot with a character, or sets their size, and builds the clip prompts again; a rule or edit for one shot links to its dialog on the timeline (`?direct=SHOT`). Taking or restoring a proposal there builds the clip prompts again as well. Choose the scope, optionally choose a character, and write the instruction. Existing rules can be edited or removed. Ask for a preview, compare before and after, resolve any conflicts or missing bindings, then take or drop the proposal. The page also offers saved plan versions and a separate request rebuild.

The workspace calls the same direction operations as the CLI and starts the CLI for the LLM preview. Project locks prevent concurrent CLI and workspace writes. No direction action starts GPU rendering.

Film dialogue can split one planned shot into several rendered parts. When a timeline shot cannot be mapped unambiguously to the plan, its direct link is omitted; open Direction from project navigation and select the source shot there.
