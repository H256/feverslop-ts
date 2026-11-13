# Guide: the workspace

The workspace shows every project and film in the browser. You see a video as a whole on a timeline and can render single parts of it again without the plan changing. This guide walks through the usual tasks; the labels are written as the page shows them. Every option in detail is in the [README](../README.md#the-workspace).

## Starting it

```powershell
bun run editor
```

Then open http://127.0.0.1:4173/. `bun run editor <id>` opens a project right away, `--film` a film, `--port=4174` takes another port. The page can only be reached from this machine. On the first start, and after a pull that changed the page, `bun run editor` builds it first (a few seconds; it needs Node.js for that).

Everything that renders is the normal CLI: the page only starts it. While a run works on a project, the project is locked - whether you started the run here or in the terminal. A run from the terminal can be followed and stopped here.

Three things hold everywhere:

- **Before every render the page asks.** The dialog says what happens, roughly what it costs and which other clips are affected. Under **Render on** you choose the servers. Nothing happens without **Start** or **Render it**.
- **Old versions are never lost.** A replaced version is put away and stays selectable.
- **`?`** shows every key and explains the terms.

## The start page

![The start page with project cards](images/workspace/home.jpg)

Every card shows how far a project is, when it was changed, and what would come next; a finished video made over or through post-work is named under the card and plays on **Post-work** when you play it. At the top you filter by kind (**Music videos**, **Films**) and state (**Running**, **Failed**, **Unfinished**, **Done**) and search with **Find a project**. A click on a card opens the project.

- **New music video** and **New film** make a project from a form - the options of `bun run init` and `bun run film:init`. A music video starts from a song file, a song of the library or an idea; a film from a story idea or a screenplay.
  The id of a music video is suggested from its name and can be changed; an id that is taken or is no folder name is said at the field. Its song is chosen as a file - sent to the workspace and copied into the project as it is created - or typed as a path on this machine. Who sings on screen is nobody, chosen from the song by the plan (`--singers=auto`), or the people named; the language is any code (`en`, `de`, …), named as it is typed. Nothing is planned or rendered by creating it.
- **Machine** shows what this machine has of what a video needs (`bun run doctor`): the language model, ComfyUI and the nodes and models the workflows name, ffmpeg, uv, disk space - each missing part with its fix. Below it the servers are set: the language model, the model that reads pictures, the ComfyUI servers to add or remove (`bun run setup … --…`).

## The bar at the top

The bar at the top reads from left to right:

- **Left** says where you are: **Projects** (the start page), **Library** and **Stats**, inside a project its name.
- **Next to it** are the project's pages as tabs, in the order a video is made: **Plan** (**Story** - for a film **Screenplay** -, **Casting**, **Singers** and **Timing** for a music video that is sung, **Look**), **Shoot** (**References**, **Timeline**, **Direction**), **Publish** (**Post-work**), and **Settings** apart. A planned stage has ✓, the one planned next ●, and a stage that a changed input or setting makes again ⟳.
- **Right** is the machine: which render servers answer and how busy they are, the colour scheme and the version of the workspace. With no server set up it says **No render server set up**, with a link to the start page.

Under the tabs, on every page of a project, is the **Next** bar: what `bun run status` says is next, with its button and the estimate. While the plan is not done, the stages to plan are next to it (**Plan the cast**, **Plan everything**); a planned project has **Plan again…**. When the next step is done on a page - instructions of the direction to check after the shots were planned again - **Next** opens that page instead of starting anything (see [After the shots are planned again](#after-the-shots-are-planned-again)).

## The main terms

| Term | Meaning |
|---|---|
| **Stale** | Made from another prompt, picture or start frame than the plan has now. The file is still usable and is only rendered again when you ask for it. |
| **Pinned** | A file of your own, an edited prompt, or older than this check. The pipeline leaves it alone. |
| **Goes on** | The clip starts on the last frame of the clip before. If that one is rendered again, the start no longer fits. |
| **Anchor** | The one picture a person or a place starts from. |
| **Sheet** | The reference picture with several views, made from a short video of the anchor. |
| **Take** | Projects whose names differ only by a date or an ending. They are one card on the start page. |

## Planning a project in stages

A new project is best planned the way a film is made: first the book, then the cast, then the look, then the shots - and only then rendered. That way you change the characters before anything is built on them, and long before GPU time is spent.

| Stage | What is made | Where you look at it |
|---|---|---|
| **Story** (film: **Screenplay**) | the story from the lyrics and the story idea, for a film the screenplay | **Story** |
| **Cast** | characters and places, for a music video also who sings which line | **Casting**, **Singers** |
| **Look** | the look of the video, how every character and place looks, the pictures if you want them | **Look**, **References** |
| **Shot plan** | the beats on the song and the shots of every clip | **Timeline** |

The **Next** bar plans the next stage and stops, for example **Plan the cast**. **Plan everything** plans without stopping up to the shots. All of this is the language model only; nothing is rendered. Before a plan run the question says what it would do (the command's `--dry-run`): which steps are made again and why, which beats or scenes are planned again and which clips turn stale. **Plan again from a step** picks a step to make again (`--redo`); for a film, with the shot plan picked, only some scenes can be planned again (`--scenes`). In the terminal: `--until=story`, `--until=cast` or `--until=look`.

**Changing the story:** **Story** has the text to edit. **Save the story** saves it; what was planned from the old story goes - "17 steps of the story, the cast, the look and the shot plan", the step names when you point at it - and the next plan run makes it again. **Write it again** has the language model write a new story. A screenplay is only read here: it is changed in the script in `input/`. When the script contradicts itself, the page lists where, and **Repair the script…** has a plan run repair it (`--fix-script`).

**The story for the cast:** **Tell it anew for the cast** has the language model tell the same story with the cast **Casting** has now: the same plot, the same places, about the same length. The proposal appears next to the story there is. **Take the new story** takes it, **Drop it** drops it. Taking it keeps the cast, who sings and the looks; only the summary and everything from the beats on is planned again.

![The proposal next to the story there is](images/workspace/story-proposal.jpg)

![The Story page](images/workspace/story.jpg)

**Changing the look:** **Look** has the look of the whole video at the top, below it for every character and place its look (the picture is made from it) and the description for the clip prompts - for a place also its background and floor plan. Change a text by hand, or tick **Write anew** to have the language model write it again. What follows from a changed text is written again for that one character or place only: from a new look the description, from a new look of a place its description, background and floor plan. All others keep their texts. After **Save** the page asks whether that is to happen right away. A changed look of the whole video writes every look again.

![The Look page with the look of the video and, for every character, look and description](images/workspace/look.jpg)

**Casting photos:** Once the look is there, **Render the pictures** renders the pictures of every character and place before the shots are planned. On **References** you look at them, change a prompt or render a picture again - without the shots being planned yet. Only the members of a group come with the shots, because how many there are is decided in the beats. In the terminal: `--until=look --render=images`.

**Changing the cast:** see [Casting and the library](#casting-and-the-library). Best right after **Plan the cast**: then nothing is built on it yet.

### The same in the terminal

Everything in this section works without the workspace; the pages start the same commands. Without an option every command prints what is there. With one it changes it, says what goes, and proposes the plan run that makes it again.

| In the workspace | In the terminal |
|---|---|
| **Plan the cast** etc. | `bun run plan <id> --until=story` (also `cast`, `look`); film: `bun film.ts <id> --until=…` |
| The question before a plan run | `bun run plan <id> --dry-run [--json] [--redo=…]`; film: `bun film.ts <id> --dry-run [--json] [--redo=coverage --scenes=s2,s3]` |
| Read and change **Story** | `bun run story <id> --out=story.txt`, change it, then `bun run story <id> --set=story.txt` |
| **Tell it anew for the cast**, **Take the new story**, **Drop it** | `bun run story <id> --adapt`, then `--take` or `--drop` |
| Film: **Add a character**, **Remove**, **Tell the screenplay anew** | `bun run story <id> --film --adapt --add="Name: role" --remove=<id>`, then `--take` or `--drop` |
| New names into the story | `bun run story <id> --rename="Soren Hale=Soren Vale"` |
| **Change the cast**, **Add a character**, **Add a place**, **Remove** | `bun run cast <id> --json > cast.json`, change it, then `bun run cast <id> --set=cast.json`. A new character is in it without an `id`, a removed one is simply missing. |
| A role from the library, **Plan now** | `bun run casting <id> --set=character:mara=library:mara-v2` - the command names the `--redo` that fits |
| **From another project…** | `bun run import-asset <id> <asset> --from=<project>:<asset> --description=source` |
| **Replace in what is planned…** | `bun run replace-character <id> --character=<id> --picture=<file> --description=vision [--dry-run]` |
| Timing: **Put the song into the library…** | `bun run export-song <id> [--as=<song-id>] [--name=<name>]`; into a project: `bun run import-song <id> <song-id>` |
| Read and change **Look** | `bun run look <id>`; `--json > look.json`, change it, `--set=look.json` |
| **Write anew** | `bun run look <id> --again=leo,location:hall` |
| **Render the pictures** | `bun run plan <id> --until=look --render=images` |

For a film add `--film` everywhere. There the screenplay is only printed, and `cast --set` changes only names and texts. A character comes or goes by telling the screenplay anew for them: `bun run story <id> --film --adapt --add="Mira: a young lighting technician" --remove=emil`, then `--take` or `--drop` (Casting: **Add a character**, **Remove**, **Tell the screenplay anew**; Story: **Take the new screenplay**, **Drop it**).

An example from the start to the casting photos:

```powershell
bun run plan my-video --until=cast
bun run cast my-video --json > cast.json
# edit cast.json: change a name, add a character without "id"
bun run cast my-video --set=cast.json
bun run story my-video --adapt
bun run story my-video --take
bun run plan my-video --until=look
bun run look my-video
bun run look my-video --again=soren-hale
bun run plan my-video --until=look --render=images
bun run plan my-video
```

## Watching a video

![The timeline with the monitor and the clip's details](images/workspace/timeline.jpg)

- **Top left** the video plays, **right** of it are the details of the chosen clip: **Prompt**, **Shots**, **References**, **Render** and **Versions**.
- **Right of the play time** you choose what plays: the finished video or **Clips over the song**, the clips one by one. To judge clips take the latter: a finished video shows the clips as they were when it was assembled.
- **At the bottom** is the timeline, from top to bottom: the sections (for a film the scenes), the beats of the story (music video), the sound, the clips with their shots, the lines sung or spoken.
- **Below it** every character has a narrow lane: grey where they are in the picture, orange where they sing or speak, green where they play. A click on a stretch opens that shot in the direction dialog (see [Directing a shot on the timeline](#directing-a-shot-on-the-timeline)).

**The bar under the lanes** shows and hides, under **Show**, the player and every lane but the clips: **Player**, **Sections** (**Scenes**), **Beats**, **Song** (**Sound**), **Sung** (**Lines**), **Cast**. The browser keeps the choice. Without the player the timeline has all the room; the sound goes on. On the right of the bar are **Fit** (the whole video) and **Zoom** (also `Ctrl`+mouse wheel over the timeline). The top edge of the timeline is dragged to make it taller or lower.

Useful keys: `Space` plays and pauses, `←` and `→` jump to the clip before or after, `,` and `.` step a frame back or on, `O` loops the clip.

**The bar above the lanes** groups the buttons by what they do:

| Group | What is in it |
|---|---|
| Counts | how many clips are rendered, missing, stale or pinned, marks, *goes on* |
| Marked | only with marked clips: **Render marked**, **Preview marked**, **Plan … again**, **People…**, **Clear** (see [Several clips at once](#several-clips-at-once)) |
| Render | **Render stale**, **Render missing**, **Render all again**, each with the number of clips |
| Check | **Only flagged** hides all others, `‹` and `›` jump from one flagged clip to the next, **Mark flagged**, **Review**, **Scan for backdrops** (looks for grey studio backdrops, no GPU), **Check textures** (whether continuing clips get grittier from link to link, no GPU), for a film **Check cuts** (whether the cuts within a scene fit, read by a model that reads pictures). What a check finds marks the clips. |
| Finish | **Preview all**, **Preview video**, **Refinish**, and, once there is a finished video, **Post-work** (goes to the Post-work tab) |

**Render stale**, **Render missing** and **Render all again** mark these clips and then ask the usual question with its estimate. **Render all again** also takes clips that count as current, for example after another seed - in the terminal that is `--again` with the clips in `--only`; `--render=all` renders only what is missing.

## Rendering a clip again

1. Click the clip on the timeline.
2. Open the **Render** tab on the right.
3. **Preview** is the cheap test: few steps, few pixels, in a folder of its own. A real clip is never replaced by it.
4. **Render again** renders the whole clip again. The dialog gives the estimated time and warns when other clips go on from this one.
5. After the render the old and the new version open side by side.

![The old and the new version side by side](images/workspace/compare.jpg)

**Play both from the start** plays both in step. If you like the old one better, take **Go back to the old one**. Later the **Versions** tab does the same with **Compare** (the window in the picture; there the button is **Make the right one current**) or directly with **Make current**.

**In the terminal:** `bun run versions <id> slot-007` lists the versions put away of a clip, the newest first. `--pick=<version>` makes one of them current again. The same works for pictures (`bun run versions <id> mara`). The current version is put away and stays selectable. For a film add `--film`. A film clip's own choice (view, references) is set with `bun run override <film-id> clip-007 --view=2 --without=<picture>`, `--clear` takes it back.

### Rendering only a part again

When only one moment is bad, give its seconds in the **Render** tab under **Render a part again** and click **Render this part**. A clip with several shots has a button for each. The rest of the clip stays; the finished video is not assembled again.

> **Careful:** this is not well tried yet. On the Radeon the job ran out of memory, and one try took the server down. For a film a part with dialogue does not work, because the sound belongs to the picture there.

## Several clips at once

![The timeline with three marked clips](images/workspace/marked.jpg)

1. `Ctrl`+click marks single clips, `Shift`+click all up to this one. **Mark flagged** marks every flagged clip.
   - A click on a **beat** marks its clips, `Ctrl`+click adds them.
   - A click on a **section** marks the clips in it, `Shift`+click the clips of every section of that name (all choruses), `Ctrl`+click adds them or takes them out.
2. Above the lanes appear **Render marked**, **Preview marked** and **Clear**.
3. While the run goes on, every clip on the timeline shows whether it waits, renders, is done or failed.

When the marked clips belong to beats, two more buttons come - both the language model only, nothing is rendered:

- **Plan … again** plans the shots of these beats again with the planner as it is now. The other beats keep their shots; the clips turn stale. A dashed beat has no shot plan yet; the next plan run plans it anyway.
- **People…** (music video) says who is in the marked clips: people of the cast or new ones with a picture of their own come in (**In these clips**, **New people**), others go out (**Not in these clips**), and **What they do there** says what they do. The beats are planned again afterwards. In the terminal: `bun run direction <id> --with=… --join=… --out=… --clips=…` (see the [direction guide](direction.md#who-is-in-which-beats-and-clips-music-video)).

> **Careful after a new plan:** almost every clip is stale then. Check the **Direction** page first and render a few marked clips as a test, rather than **Render stale** or **Next** at once. Where **Next** would render most of the video, its question warns; and before any clip is rendered, **Next** renders one first.

## Going through clips and deciding

![The review with its key bar under the picture](images/workspace/review.jpg)

**Review** goes through the marked clips one by one, each in a loop - with nothing marked the flagged ones, else all. It plays only with `Space`; by itself only when **Play by itself** in its bar is ticked (the browser keeps that). After several clips were rendered again they are marked; you start the review yourself.

| Key | |
|---|---|
| `Space` | play or pause |
| `Enter` | fits, next clip |
| `R` | render again: only noted, on at once - rendered at the end |
| `←` | back |
| `C` | compare with the older version |
| `Esc` | end the review |

At the end exactly the clips noted with `R` stay marked, and the page asks whether to render them.

## Changing the direction afterwards

The movement, acting and framing of a project already planned can be changed afterwards. The story, the cast, the reference pictures, the sound and the cuts stay. The direction need not be decided when the project is made.

### Directing a shot on the timeline

**Shots → Direct this shot** on the timeline opens the shot in a dialog: framing, camera, action, and below it every person in the picture with what they do (**Start**, **In frame**, **Movement**) and whether they sing, play or speak.

- **Shot size** (wide, medium, close, extreme) changes the plan directly, without the language model, and the clip prompts are built again at once.
- **Take out** marks a person, several too. **Take … out of the shot** takes all marked ones out in one step, by code. Whoever sings, plays or speaks in the shot cannot be taken out. If the shot's text still names one of them, one proposal of the language model starts at once that writes the shot without all of them; **Take and build the prompts** takes it, **Drop** builds the prompts with them taken out only. Otherwise the clip prompts are built again at once - in the same request that takes them out. **Rewrite the words** asks again for someone taken out before, **Undo** takes a direct change back.
- **Bring in** shows everyone of the cast who is not in the shot. **+ Name** marks them, several too; below goes, if you like, what they do here. **Bring … into the shot** puts them into exactly this shot by code, and one proposal of the language model writes where they are and what they do. The other shots of the clip and the beat stay as they are; this way someone of shot 2 also comes into shot 1. Someone taken out with **Take out** before only has that taken back. Once the proposal is taken, **Undo** no longer takes them out; **Take out** does.
- Under **Instructions** you write an instruction for the whole shot or, with **Instruction for …**, for one person in it. **Propose** saves it and asks the language model in one step. **Proposed** then shows only the changed fields, before and after.
- **Take and build the prompts** takes the proposal and builds the clip prompts again; then render the clip on the timeline. **Drop** drops the proposal.

Direct changes survive a new plan: the planner gets them as a given, and the code puts them through in the new plan too. A change for a single shot has to be assigned again after a new plan, because the new plan has other shots.

### Instructions for several shots

1. Open **Direction** in the project's tabs.
2. Under **Scope** choose the project, a character, a beat or scene, a stretch of the song or a shot. **Only for character** narrows it further.
3. Under **Instruction** write, for example, "Kael turns to his left until his back faces the camera" or "a close-up of the fretting hand in the guitar solo". **Save instruction** keeps your own words.
4. **Preview changes** starts the CLI's call to the language model. **Before / After** shows the changes it proposes, pose and movement included. Contradicting instructions of the same rank or a continuity problem keep it from being taken: correct the instructions or widen the scope and propose again.
5. **Take changes** takes the proposal and builds the clip prompts again; **Drop proposal** drops it. Then render the stale clips on the timeline. The direction itself renders nothing.

Under **Direct edits** you make direct changes for several shots, without the language model: take a person out of every shot of a beat, a scene, a stretch of time or of every shot with a certain character, or set the shot size there. **Add edit and build the prompts** saves them and builds the clip prompts again; **Undo edit** takes them back. For an instruction or change of a single shot, **open in the timeline** opens the shot in the direction dialog.

A stretch of time covers every whole shot that overlaps it; it makes no extra cuts. **Remove instruction** removes the instruction but does not undo a movement already taken.

### After the shots are planned again

When the shots are planned again - after a changed setting, or with **Plan … again** - this holds for what was made for the old shots:

- **Direct changes** for a shot planned again no longer fit; the new plan has its own shots. The plan run drops them and says so in its log. On **Direction** such leftovers are under **Left over from the old plan**; **Clear them out** removes all of them with one click.
- **Instructions** not yet taken by a preview no longer stop a plan run: the clip prompts are built without them, and the run names them. A run that renders clips stops for them **at its start**, not after the planning.
- An instruction for a shot planned again is among the leftovers too: **Keep for the new shot** applies it to the shot as it is now, **Clear** drops it. An instruction that hits no shot at all is under **To decide**: change it for a shot there is, or remove it.

Render only after that, a few marked clips first (see the warning under [Several clips at once](#several-clips-at-once)).

Instructions that went to the planner (with **People…**) need no check. In the terminal `bun run status` names the open instructions and, as the next step, `bun run direction <id> --preview`.

### Bringing plans back

Under **Plan versions** an earlier plan that still fits, the original plan included, can be restored. Videos already rendered stay. Examples for the CLI, the JSON format and the rules are in the [direction guide](direction.md).

## Following or stopping a run

![A render running, with its bar at the foot of the page](images/workspace/run.jpg)

The foot of the page says what runs now: for a render a bar with the clips done and all of them (`12/37`) and the percent - counted from the run's own events -, otherwise the step it is at, and how long it runs. **Log** shows the CLI's output, **Stop** ends the run. Finished files stay. The jobs the run waited for - pictures, sheets and clips - are cancelled on their servers: taken out of the queue, or stopped when it is the run's own job (never someone else's). The server is free at once, and the next run renders them again. Ctrl+C in the terminal does the same. Only when a run crashes or the machine goes to sleep do its jobs go on, and the next run picks them up.

**Asked for while a run goes on:** a button that starts a run asks whether it is to start after this run. It then waits in the project's queue (`logs/queue.json`) and starts as soon as the project is free - also when the workspace was started again in between. The run bar shows what waits, with ✕ to take it out, and **Runs** lists the runs that ended, with their state, time and log. In the terminal: `bun run runs <id> [--remove=<id>]`.

**When something goes wrong:** for known failures the bar says in plain words what happened and what to do, with **Repeat**. When the fix is on another page - "Direction needs review" - a link goes there. Other failures are in the **Log**. The most common one is `out of memory`: take another server, or render shorter or smaller, rather than sending the same job again.

## Changing reference pictures

![The References page with cards and details](images/workspace/references.jpg)

**References** has every person, place and prop. On the right are the prompt, the views, older versions and the clips that use the picture. During a run every picture appears here and on **Look** as soon as it is done, not only at the end of the run.

- **New sheet, same anchor**: the same person, other views.
- **New anchor**: another person or place; everything after it is made again.
- **Change the prompt** and render: the picture stays pinned afterwards, the prompt of the plan stays as it was. The prompt field then shows the changed prompt, and you can change it further and render again.
- **Take the plan's prompt** brings the plan's prompt back. Rendered with it, the picture is no longer pinned and follows the plan again; the anchor of the changed prompt goes with it.
- **Use my own anchor** puts a picture of your own in as the anchor, whether it was made by hand in ComfyUI or anywhere else. You upload it (PNG, JPEG or WebP, at most 50 MB), with a prompt as a note if you like. The description the clips and the sheet give of the person or place you keep, write yourself, or have the vision model read from the picture - the last only when a model is set up that reads pictures. ComfyUI then renders the sheet from your picture; what was there before is among the older versions. The uploaded picture is kept in a temporary folder of its own for the run only. In the terminal: `--render=images --only=<id> --again --picture-anchor=<picture> [--picture-description=<file> | --describe-picture]`.
- **Make current** brings an older version back.

A pinned picture can be rendered again too, your own as well; what is there goes to the older versions. The render buttons are only locked when a library asset plays the role. Clips that use the picture are stale afterwards but are not rendered again by themselves: that is decided on the timeline.

## Casting and the library

![The Casting page with a choice for every role](images/workspace/casting.jpg)

**Casting** shows every role and place with a choice: **Rendered in this project**, or an asset of the library. A change writes one entry of `casting.json`; it takes effect with the next plan run (**Plan now**). The question before it names the steps planned from the role's old texts, which are planned again. The clips concerned turn stale; nothing is rendered by itself.

Every role also has:

- **From another project…** (music video): a finished character or place of another music video taken over - its picture and its whole reference sheet, pinned, nothing rendered - with the description of that picture, one written from it, or the one here.
- **Replace in what is planned…** (characters): a picture of your own on this machine for the character, with the description to go with it. What it would do is shown first (`bun run replace-character … --dry-run`).

**Props** (music video, with **Prop pictures** on in the Settings, #944): every character's prop - a guitar, a drum kit - has a card of its own below the roles, with its picture, whose it is and how many clips have it. The characters and the places are then drawn without their props. **From the library…** gives the character a prop of the library instead: its name, description and picture, copied and pinned, nothing rendered (`bun run import-asset <id> prop <library id> --for=<character>`). The shots stay; the clips with the character are built with the new prop from the next run on. A prop goes into the library with **Put into the library** on **References** or `bun run export-asset <id> <prop id>`.

**Change the cast** changes the cast itself, without the library: the name, the role in the story and the prop of every character, the names of the places. For a music video characters and places can also be added and removed: **Add a character** and **Add a place** are above the lists, **Remove** on every role's card. **Add** opens the cast for editing with the new character or place already in it. **Remove** keeps the card in the list, marked "Out of the cast when saved"; **Put back** on it brings the role back. A bar at the bottom counts who goes and saves every removal at once (**Save the cast**) or drops them (**Discard**) - so many roles go in one go and are saved once. In the form of **Change the cast**, who goes on saving is said above the button, with **Put back** next to it. In a film the screenplay decides who is in it: there **Edit the roles and places** changes name, role, appearance and voice. The ids stay, so a renamed character keeps its pictures and its entry in `casting.json`.

**A character into or out of a film** (#589): when the pipeline wrote the screenplay itself from `input/idea.txt`, **Add a character** is above the characters and **Remove** on every card. A new character gets a name and their role in the story. The bar at the bottom counts who comes and who goes, and **Tell the screenplay anew** has the language model write the screenplay again for this cast: the same scenes at the same places, a part for the new ones (with appearance and voice), nothing more of those who go, the dialogue of the others word for word as far as it can. The code checks the answer and asks once more on a fault. The result waits on the Story page next to the screenplay. **Take the new screenplay** takes it: who stays keeps id, looks and pictures, the look of the film and the places stay. What is read from the script goes (summary, props, shots, script notes); the next plan run writes it again, with the looks of the new ones. With a screenplay of your own (`input/screenplay.txt`) this cannot be done, because there the pipeline checks that no line is changed; the page then says to add or remove the character in the script and plan again.

**Save the cast** says beforehand what was planned from the old cast and goes: the looks, for a music video also who sings, later the beats and shots. The next plan run makes it again, the language model only; for a music video only the looks of the new or changed characters and places are written again, all others keep theirs. After saving the page asks: for a renamed character **Put them in** puts the new name into the story (as a whole word, also a first or last name alone). When someone came or went, it offers to tell the story for the new cast (see above).

![Change the cast: name, role and prop of every character, above it who goes on saving](images/workspace/cast-edit.jpg)

**Library** (top left next to **Projects**) shows every asset and song and where they are used. **New asset from a picture** makes one from a picture; a song plays on a click and shows the projects made from it. An asset can be renamed, described anew or removed (put away, not deleted). From a project, **Put into the library** on **References** puts an asset in. An asset the library has is never overwritten. In the terminal: `bun run library [rename | describe | remove …]`.

## Who sings which line

**Singers** (only for a music video in which someone sings) lists every sung line, grouped by the parts of the song. After every line are the singers as switches: one sings it alone, several sing it together (duet, choir). **All of these** switches a singer for a whole part of the song. **Add a singer from the cast…** brings in someone of the cast who does not sing yet. The ▶ button (or `Space`) plays the line from the vocals stem - so you hear whether a woman's or a man's voice sings it. On the timeline **Change singers** in the Shots tab goes to the first line of the clip.

**When the singer changes in the middle of a line**, click between the two words: a new part starts there. Every part gets switches and a ▶ of its own, and the words are underlined in the colour of their singer. A click on the split takes it back. Two parts with the same singers become one again on saving. The split sits on the times of the words from the alignment with the transcript; for a line that was hardly found there they are only estimated - the page says so, and ▶ for each part helps.

Keys on a line: **1** to **9** switches the singer of that number (in a split line in the chosen part), **← →** chooses the part, **↑ ↓** goes to the next line, **Space** plays the line or the chosen part.

On the right is what saving causes: the beats in which a changed line is sung lose their shot plan, their clips turn stale. A singer not yet in such a beat is added, and the beat is staged again without its floor plan. **Save and plan** then starts the plan run. It asks the language model about these beats only - all other beats and the story stay, nothing is rendered. `bun run status` and `--dry-run` name the beats without a plan.

The assignment is in `project.json` (the step `singing`). It stays until `lyrics.txt` or `singers` in `config.json` change, or `--redo=singing` asks the model again.

**In the terminal:** `bun run singers <id>` lists the lines, numbered from 1. `bun run singers <id> --line=12:mara,ben` has line 12 sung by Mara and Ben. For more at once `--json > singers.json` writes the lines to a file; change them - a change in the middle of a line as `parts` - and give them back with `--set=singers.json`. The command then names the beats to plan again and the plan run.

## When the lyrics are sung

**Timing** (for a music video with aligned lyrics) shows at the top the waveform of the vocals stem around a line, above it its words as boxes, below it all lines. **Estimated** filters the lines the alignment with the transcript hardly found: their times are only spread over the line and can be seconds off.

- Dragging a word moves it, dragging its edges changes its start or end. When it bumps into a neighbour, the neighbour gives way.
- The bar above the words moves the whole line. **← →** moves it by 0.05 s, with Shift by 0.5 s. **Tab** chooses a word, then the arrows move the word, **Esc** the line again.
- **Space** plays the line or the chosen word, a double click a word, a click into the waveform plays from there. **Ctrl+mouse wheel** or **+ / −** zooms, **Ctrl+Z** undoes.
- Dashed lines are the cuts between the clips. When a cut falls into a word, the word gets a red frame and the page warns.
- **Hide the side column** folds the column on the right away for room; the browser keeps that.

With known lyrics nothing is lost and nothing is added quietly. Every line of `lyrics.txt` is there exactly once, with its own words. A word Whisper did not hear stays in the line as estimated. When a line does not fit `lyrics.txt` (a word missing, the line missing, or found nowhere), the page shows it as **check**. When Whisper heard singing that `lyrics.txt` does not have, a repeat for example, it becomes an **ad-lib**: a proposal no clip sings until you choose **Sing it**. A line Whisper hears twice at the same place makes no ad-lib.

**Back to automatic** sets a line placed by hand back to the automatic alignment, **All back to automatic** all of them. The alignment is computed again from the saved transcript; Whisper does not run again.

**Save** keeps the cuts: the vocals of every clip are computed again from the new times, only beats with changed clips lose their shot plan. **Save and plan** plans them again at once. **Save and cut the song again…** cuts the song again around the new times (`--redo=timeline`) and plans every shot again - that takes a while. Moved lines count as placed by hand, no longer as estimated. The times are in `project.json` (`lyricsTiming`) until `lyrics.txt` changes or `--redo=lyricsTiming` aligns again.

**In the terminal:** `bun run timing <id>` lists every line with its start and end. `--json > timing.json` writes the times of the words to a file; move `start` and `end` and give it back with `--set=timing.json`. Lines given back unchanged do not count as changed. When a cut then falls into a word, the command says so and names `--redo=timeline`. `--reset=12,40` or `--reset=all` sets lines placed by hand back to the automatic alignment, `--on=N` sings an ad-lib. The list names ad-libs and lines that do not fit `lyrics.txt`.

**The song into the library:** **Put the song into the library…** copies the song, the lyrics, the six stems, the analysis, the transcript and the saved timing into the library (`library/songs/<id>/`), with every line placed by hand. Save first: the button is locked while moved lines are not saved. A new project takes the song with **New music video** on the start page, `bun run init <id> --library-song=<song>` or `bun run import-song <id> <song>`, and starts at the story: nothing of the song is made again. Every project gets a copy; a later change of the timing changes neither the library nor other projects. A song the library has is never overwritten. In the terminal: `bun run export-song <id> [--as=<song-id>] [--name=<name>]`.

## Changing the settings of a project

The **Settings** page has the render settings of the project, what its `config.json` holds otherwise: the **Video workflow** (for example `h3-ref2video-prism-2pass` instead of `h3-ref2video-2pass`), the workflows for pictures and sheets, the size of video and pictures, the aspect ratio, continuity and context frames, the seed, the retries, the language model of the project, and the frame rate of the finished video. In the group **Finish** you switch the finish of the finished video on and set each value on its own: black and white point, contrast, saturation, sharpness, **Colour match** with its reference clip, and **Film grain** (about 3 is light). While the finish is off, these fields are locked. Every setting says what it does and what its default is. **Use the default** goes back to the default, **Undo** to what the project had.

1. Change what you need. A changed setting has a coloured bar on its left.
2. Click **Save**. The question before it says what changes and **how many rendered clips and pictures turn stale by it**. The workflow, the size and the aspect ratio are part of what a clip is made from: when one of them changes, the clip is stale. Other settings - the retries, the frame rate of the finished video - make nothing stale.
3. Saving **renders nothing**. The timeline then shows which clips are stale, and you render them when you want.

> **Careful with continuity and context frames:** they decide how long a clip may be at most (a clip that starts on the last frame of the one before is planned shorter by the context frames). When that length changes, the next plan run cuts the song again and plans every shot again, also where nothing would have changed. Every clip is stale afterwards, and the direction's instructions have to be checked (see [After the shots are planned again](#after-the-shots-are-planned-again)). Planning again only what the change concerns is issue #781.

A wrong value is refused, in the same words as at the start of a run. A very high value is only remarked on, never lowered. While a run works on the project, nothing is written: wait until it is done.

**In the terminal:** `bun run config <id>` shows the settings, `--set=videoWorkflow=h3-ref2video-prism-2pass` changes one (several times if you like), `--unset=seed` takes one out of the file. For a film add `--film`. Other keys of `config.json`, such as the singers, are changed on the page they belong to, or by hand.

## Making an older project over

![The Refinish dialog](images/workspace/refinish.jpg)

**Refinish** in the bar above the lanes makes a finished project larger, smoother and graded like the newer ones, from the clips it has. No plan runs and no prompt changes. `videos/` and the finished video stay as they are: every variant gets a folder and file names of its own.

| Choice | What happens | Cost |
|---|---|---|
| **Grade and sharpen only** | colour and sharpness | no GPU |
| **48 fps, grade and sharpen** | in-between frames too | about 15 minutes for 37 clips on the Radeon |
| **Full HD by a refine pass, 48 fps, grade and sharpen** | the second render pass on every clip too | about 6 s per frame on the Radeon, so many hours for a whole project |
| **Say it one by one** | choose everything on its own | |

Below the choice it says what the finish will do, for example *grade, sharpen 0.4, grain 3*. Grain and colour match are set on **Settings**; the link there closes the dialog. With the finish off there, Refinish takes the mild one.

A sensible way:

1. **Mark one or two clips**, best one with singing. With marked clips only the larger clips are made, no finished video - so this is only worth it with a variant that makes them larger: without that nothing is made at all.
2. Open **Refinish** and start the variant.
3. In the **Render** tab under **Larger versions** click **Compare with the original** and watch **with the sound**. A refine can change mouths a little. Check clips that *go on* too, because every clip is worked on by itself and the join can jump.
4. When it fits, start it for the whole project without marks. Clips already done are not made again.

The variants appear in the choice next to the play time as **Clips: refine-fullhd**, the finished videos as **Refinish refine-fullhd 48 fps finished**. The options for the terminal are in the [README](../README.md#making-an-older-project-over).

## Before publishing: the Post-work tab

Everything done to a finished video before it is published is on the **Post-work** tab, in the order recommended: **AI marker**, **Title card and credits**, **Intro** and **YouTube text**. Every step is a card with its form. The first one not made yet is open; a step is *made* once any video of the project went through it, and its head names the newest such file.

Every step starts from what the step before wrote, once there is one: the credits from the labelled video, the intro from the video with credits, the YouTube text from the newest. **From** changes that.

On the right, **What the steps made** lists the videos of the steps and every video with a YouTube text. The chosen one plays only when you start it; below it is its YouTube text with **Copy**. These videos are not on the timeline: there the music video itself plays with its versions, and **Post-work** in its bar leads here.

**For a video editor**, below it, gives a music video's timeline to cut further elsewhere: **Shotcut / Kdenlive** and **OpenShot** write `timeline.mlt` or `timeline.osp` (the rendered clips on one track, the song under them). They can be pressed when that run has nothing to plan first and every clip is rendered. A film writes `output/timeline.edl` when it is assembled; the card shows it once it is there.

## Before publishing: the AI marker

**AI marker**, the first step on **Post-work**, lays a marker over a finished video, as a new video next to it: `<name>-labeled.mp4`. The video it starts from stays as it is.

1. **From**: which video. When there is a finished one, it is chosen.
2. **Marker**: an EU icon for AI-generated content (*AI GENERATED*, *AI MODIFIED* or *AI*, white or black, opaque or 50 % see-through), or *A PNG of my own* with its path.
3. **When**: only at the start (enough for a music video or a film, an artistic work), at the start and then again at intervals, or all the time. Then the corner, the height and the margin.
4. **Keep these settings for this project** writes them into `config.json`; the form opens with them next time. **Keep them for every project** writes them into the settings file.

It runs on this machine, without a GPU, about as long as the video lasts. The new video appears on the right under **What the steps made** as *… + AI label*. Why and when such a marker is needed: [docs/postwork.md](postwork.md).

**In the terminal:** `bun run label <id>` with the same choices as options (`--marker=`, `--mode=`, `--corner=`, …).

## Before publishing: title card and credits

**Title card and credits** on **Post-work** puts a title card before a finished video and credits after it that scroll up: `<name>-credits.mp4`.

- **Title card**: the title (empty: the project's), the artist - for a film who directed it -, the disclosure (*Contains AI-generated content*) and, if you like, the AI marker below it.
- **Credits**: the title again, lines of your own (one per line: thanks, links, your channel) and what it was made with: the language model, the models, the graphics cards. That comes from what this project really used; nothing is made up. Your own words on the hardware follow it.
- A sound under the credits (a path), else silence. For the lengths, 0 for the credits means about 1.5 s per line.

When you keep your name and your lines for every project, the next video needs only a click. The run shows the credits line by line before it draws them.

**In the terminal:** `bun run credits <id> [--artist=…] [--line=…] [--dry-run]`.

## Before publishing: an intro

**Intro** on **Post-work** puts a clip of your own - a logo, a channel intro - before a finished video: `<name>-intro.mp4`.

- **From**: which video. The last one the steps before made is chosen, the labelled one with credits: the marker then starts after the intro.
- **Intro**: the path of the clip. Empty takes `input/intro.mp4` of the project; the field says when there is one.
- **Fade**: how many seconds the intro fades into the video. 0 is a hard cut.

The intro is made like the video: the same size and frame rate, black bars for another aspect ratio, silence when it has no sound. When you keep the intro for every project, the next project needs only a click.

**In the terminal:** `bun run intro <id> [--file=<path>] [--fade=0.5]`.

## Keys

![The window with every key and term](images/workspace/keys.jpg)

`?` shows this window on every timeline.
