# Changelog

One section per release. The section of a tag becomes its GitHub release (`.github/workflows/release.yml`).

## v0.6.0 – planned in stages, sung and timed by hand, and a workspace in Vue

_2026-11-03_

A video is now made as a film is: the story, then the cast, then the look, each looked at and changed before the shots are planned on it, and the pictures of cast and places rendered before the first beat. Who sings which line, down to a word, and when each word is sung, are pages of their own. Everything the workspace changes is a command first. The workspace itself is rebuilt as a Vue client, page for page, checked by hand on real projects, and replaces the former single page; `bun run editor` builds it by itself. 28 pull requests since v0.5.0 (#463–#564).

### Highlights

- **Planning in stages**: `--until=story|cast|look` plans up to a stage and stops, the next run goes on from it; the workspace shows the stages and plans the next one (#535).
- **Story, cast and look by hand**: a Story page, Edit the cast, and a Look page for the look of the whole and of every character and place. What was planned from a changed text goes, only that one element is written again (#535, #545).
- **Casting photos**: characters and places rendered once the look is planned, before beats and shots (#543).
- **Singers and Timing**: who sings which line, with a change of singer inside a line (#521, #536); the words on the vocals' waveform, dragged or moved by key (#539).
- **CLI first**: `story`, `cast`, `look`, `casting`, `singers`, `timing`, `versions` and `override` as commands on the same code as the pages, guarded by a test (#550–#552).
- **The workspace in Vue**: every page of the workspace as a Vue client, with the FeverSlop logo and the version it belongs to in the top bar; built on the first start and after a pull that changed it (#561, #562, #564).

### Workspace

- Stage bar on Story, Casting and the timeline of a project without clips; the stage on the start page card (#535).
- Story page: a music video's story changed by hand or written again, a film's screenplay to read; the story told anew for a changed cast, to take or drop (#535, #545).
- Casting: Plan takes the casting over with the `--redo` it needs, after saying which steps that is; Edit the cast changes names, roles and props without the library (#535).
- Look page: looks, descriptions, backgrounds and floor plans by hand or written anew; whoever stays in the cast keeps their look (#545).
- Render the pictures from the stage bar at the look stage, and on References without planning the shots first (#543).
- Singers page: a click between two words starts a part with its own singers; the clip's vocals, prompt and shot plan follow it (#521, #536).
- Timing page: a word, its edges or the whole line dragged on the vocals at 100 values a second, a neighbour giving way; cuts that fall into a word named; saving keeps the cut of the song (#539).

### The Vue client

- A client of its own in `client/` (Vue 3, TypeScript, Vite), built into the editor and served by Bun (#561).
- `bun run editor` builds the page when it is missing or its sources changed since (a stamp over `client/`, `shared/` and the release number), installing the client packages first if needed. Node.js is needed for that build only; the pipeline commands need no client tooling (#564).
- The former single page (`lib/editor/page.html`) and the `FEVERSLOP_EDITOR_UI` switch are gone (#564).
- One set of wire contracts in `shared/workspace.ts` for server and client: a drift is a type error on either side (#562).
- Every page ported: overview, library, timeline with player, inspector and review, story, casting, look, references, singers and timing. Unsaved changes ask before leaving; a clip in the address is gone to (#562).
- The FeverSlop logo: the brain as the mark in the top bar and as the icon of the tab, the whole logo on top of the README.
- Tests: unit tests for the logic without a browser (`bun run client:test`), Playwright against the real editor (`bun run client:e2e`), and the real editor with its built page (`bun run test:workspace`) (#561, #562, #564).

### CLI

- `bun run story`, `cast`, `look`, `casting`: print a stage, set it from a file or by option, and name what a change drops and the run that makes it again (#550).
- `bun run singers`, `timing`, `versions` (`--pick` makes an older version current again), `override` for a film clip's view, order and references (#551).
- A test fails on any change the workspace makes that no command makes (#552).
- `bun run status` says where the preproduction stands, with the next command (#553).

### Rendering and prompts

- A fixed seed gives every clip a seed of its own: the same clip comes out again, but clips no longer share one noise. Projects with a fixed seed render other noise from now on, for clips rendered again (#504).
- Clip prompts say what is there instead of what is absent: at cfg 1 a "no" brings in what it names (#506).
- A singer never walks away from the camera, nobody steps back even half a step (#544, #534).
- Music clips record their context frames; `texture-chains` measures whether continuing clips get grittier (#503, #505).

### Film

- `bun run film:check-joins`: the cuts within a scene checked by a vision model against the staging and looks; reports only, with the command to render again (#476).
- Tests for the look of a film (#547).

### Code, tests and docs

- Housekeeping, passes two to five plus 13 verified issues: one owner each for config rules, picture paths, boundary frames, prompt helpers, the sheet layout, film lists and tool duplicates; `--only` checked the same everywhere; unused names removed (#463, #474, #492, #502, #520).
- GPU test of the workspace: retake of one shot, a sheet version keeps its anchor (#533). Startup tested without machine settings or project data (#538).
- Guide: the story proposal next to the story, and the commands next to the workspace buttons (#545, #550).

## v0.5.0 – the workspace, and older projects made over without a new render

_2026-11-02_

A whole video can now be reworked in the browser: `bun run editor` shows every project and film, one continuous timeline and the state of every clip, and starts the CLI for what is to be rendered again. `bun run refinish` gives an older project a larger size, 48 fps and the finish from the clips it has. Around that: errors and runs that say what happened, and a fresh checkout that starts without a ComfyUI server. 29 pull requests since v0.4.0 (#390–#461).

### Highlights

- **The workspace** (`bun run editor`): start page over all projects and films, a timeline with sections, sound, clips and sung or spoken lines, clips playable in place with prompt, shots and references next to them (#443).
- **Rework from the page**: render a clip again, compare and pick versions, make previews, render several marked clips with progress on the timeline, go through clips by key in a review (#443, #452). Everything that renders is the CLI, under the same lock as in the terminal.
- **Refinish** (`bun run refinish`): an older project larger, at 48 fps and finished, without a plan run and without overwriting anything. Every variant has its own folder and final videos, and can be compared with the original (#459).
- **A guide to the workspace**, step by step with screenshots, in German (#461).
- **Errors that say who failed and at what**, failed renders named, and how the last run ended kept with its command (#418, #419).

### Workspace

#### Pages
- Start page: how far each project is, its last run and what comes next, with pages, search, filters by kind and state, and the takes of one thing folded into one card (#443, #451).
- References: every picture with its prompt, sheet, older versions and the clips that use it; a new sheet from the same anchor, a new anchor, an edited prompt, or into the library (#443).
- Casting: `casting.json` as a page (#443). Library: who uses what, a new asset from a picture (#443).
- Render servers on every page: how busy each one is, and a choice of servers before a render (#451).

#### Timeline and clips
- Marks on clips that are missing, stale, failed in the last run, or show a grey backdrop (#443).
- The monitor plays any finished version and says what it shows, with size and frame rate (#443).
- `--preview` and a preview video, and `--retake` for a part of a clip or one shot (#443).
- A film clip can have its own choice of view and references; `bun run add-view` renders one more view of a place from its anchor (#443).
- Keys, frame steps, loops, a hover preview, and `?` for all keys and what the words mean (#452).
- Several clips marked and rendered together, with waiting, rendering or done on every block (#452).
- Review: through the marked or flagged clips one by one, and old and new side by side after a render (#452).
- Plain words for failures, with what to do (#452).

#### Run control
- Start, follow and stop a run from the page, also one started in the terminal (#443).

### Refinish

- Larger clips by `--upscale=refine`: the second pass of a two-pass render on the finished clip, with its prompt, pictures and song; the clip keeps its sound and length (#459).
- `--upscale=latent` (the latent upscaler alone) and `--upscale=model` (an upscale model, frame by frame) (#459).
- Presets `grade`, `smooth` and `fullhd`; `--size`, `--denoise`, `--fps`, `--finish`, `--only`, `--again`; a dialog in the workspace (#459).

### Rendering and finishing

- A clip with context frames is planned shorter by exactly those frames, so it stays within what the model can take (#402).
- A request that timed out on a server that answers again is retried, and the job is picked up from its pending file (#404).
- Color match keeps the gain near 1 and leaves nearly black frames alone, so a blackout no longer clips bright shots (#406).
- The estimate compares clips in the sizes their timings record: three clips no longer come out at 1h 25m when they take 9 minutes each (#407).
- A warning when a server often failed on clips of this length (#421).

### Shot planning

- Walking direction relative to the camera, no steps back, and the layout tied to the first view (#413).

### Init

- Asks for the final frame rate and for the finish (#399).
- FLAC accepted as the song, next to wav and mp3 (#415).
- The crash in the custom render settings fixed, and the error when choosing singers (#397).

### LLM

- A server without a Responses API falls back to Chat Completions, also for calls with pictures (#409, #411).

### CLI, runs and errors

- Runs name failed renders and keep the command and how the last run ended (#418).
- A failing server or tool says who failed and at what (#419).
- `--help` explains every option and `--redo` step of `index.ts` and `film.ts` (#420).
- A key given as `--llm-key KEY` is left out of the run record (#424).
- A fresh checkout runs without the generated `comfy/nodes.ts`: planning, `--help` and the tests no longer need a ComfyUI server (#425).

### Code and docs

- One place each for prompt helpers, the gender check, the `--again` warning, `MAX_CLIP_SEC`, timestamps and clip durations (#432–#437).
- Golden snapshots no longer depend on the bytes ffmpeg writes (#417).
- Docs: dead references removed, props and views in the film steps, environment variables, examples (#390).
- `docs/workspace-guide.md`, in German, with screenshots (#461).

## v0.4.0 – the film pipeline catches up, init for your own songs, a vision model of its own

_2026-10-25_

The film pipeline reaches the music video's quality features through the code both share: two-pass clips, context frames, the backdrop check, finishing, 48/60 fps, casting and the asset library, and the same tools. On top of that, films get the views of their places right: a clip is given the one view of the place its shots are in, described by what that view shows. Init now starts a song from your own lyrics and asks for the render settings, and pictures can be read by a vision model of their own. 31 pull requests since v0.3.0 (#346–#388).

### Highlights

- **Films at music-video level**: two-pass clips and `videoAspect` (#371), `contextFrames` and the backdrop check (#372), finishing, color match and `finalFps` (#373), `casting.json` and the asset library (#374), `--dry-run`, `--review`, `status` and `inspect` (#375) - all through the renderer and final pass the music video uses, proven unchanged by golden snapshots (#370).
- **The right view of the place per clip**: without designed views a vision model reads what each view of a location sheet shows, the LLM chooses the view of every shot, and the clip gets that one view instead of the whole sheet (#382, #386). The place is described by what that view shows, not by the description of the hero picture (#387).
- **Props with a picture of their own**: the things people handle and that come back (an umbrella, a key) are read from the script, get a plain picture each, and every clip that shows one gets it as a reference - the same thing in every clip instead of a new one each time (#388, fixes #380).
- **Space that holds together in a film**: the camera keeps one side of the action per scene, people enter where they came from, nobody is brought into a shot twice (#387); a clip goes on from the one before only in the same picture, else a plain cut (#379).
- **Other looks of a character** (wounded, soaked) are drawn from the anchor of the normal picture, with the change named in every view (#377).
- **Init for your own songs**: lyrics of your own, who sings them, the aspect ratio, presets for the render settings, a summary before writing, and the run started at the end (#350–#362, #367).
- **A vision model of its own** for describing and reading pictures (`bun run setup vision`) (#368).

### Film

#### Rendering and finishing
- Two-pass clips (`h3-ref2video-film-2pass`) and `videoAspect` (#371).
- `contextFrames` and the backdrop check (`leakRetries`) through the shared renderer (#372).
- `finish`, color match and `finalFps` through the shared final pass (#373).
- A clip goes on from the one before only where the picture goes on (the same take); otherwise a plain cut without context frames (#379).

#### Places and views
- The view of every shot is chosen from the views read from the location sheet, and the clip gets that one view (#382). The views are read only with a model that surely reads pictures; otherwise the clip gets the whole sheet as before, with one note (#382).
- The chosen view wins over the number the planning wrote without being shown any views (#386).
- The place is described by what the clip's view shows; a shot in another view says what that side shows (#387).
- Figures stay where the shots put them - also beyond a door or a window (#382).

#### Shot planning
- One camera side per scene; people who come from the scene before enter through the feature that leads there (#387).
- Nobody is already in the picture and also comes in during the same shot (#387).
- A hand does one simple thing per shot; weather that falls is in the picture, not only in the sound (#379).
- A look is offered only from its scene on; places are named by fixed landmarks, not by where the camera is (#379).

#### Props
- Step 8d `props`: at most six props read from the script, their look put together from fields of the thing alone - where it stands or who holds it never ends up in its picture (#388).
- A plain picture per prop (`assets/props/<id>.png`), the shot planning names the props of every shot, and a clip gets their pictures after the place and the people (#388).

#### Characters and looks
- Another look's sheet starts on the anchor of the normal picture and shows the change in every view (#377).
- Character descriptions list the clothing garment by garment, from the sheet (#379).

#### Casting and tools
- `casting.json` and the asset library for films (#374).
- `--dry-run`, `--review`, `bun run status` and `bun run inspect` for films (#375).
- Film init: the style list has "← back" and shows a style before it is taken (#376).

### Reference sheets (music video and film)
- The expression of a character sheet's last view comes from its description, not from chance - a sheet no longer counts as stale on almost every run; sheets made before keep their expression (#385, fixes #378).
- A location sheet keeps its fixtures in every view: the same lights, doors and furniture, none added or doubled (#385).
- `--refresh=pictures` keeps the anchor of a sheet whose anchor did not change (#385).

### Init
- A song from your own lyrics, who sings it, the image and video workflow (#350).
- The lyrics language is asked early, for every project (#357).
- A picked style is shown in full before it is taken (#358).
- The singers are asked next to the voice and follow it (#359).
- The aspect ratio, and presets for the render settings (#360); continuity and `contextFrames` under the custom render settings (#367).
- A summary before writing: write, change one answer, or cancel (#361).
- The run can be started at the end (#362).

### LLM
- A vision model of its own for describing pictures, on its own server or as another model on the text server (`bun run setup vision`) (#368).

### CLI, tools and logs
- Unified logging, common options (`--verbose`, `--debug`, `--quiet`, `--banner`) and an adaptive ASCII banner (#365); no duplicated header or Next line in `status` (#384).
- Progress of the finish step is shown (#383, #384).
- `bun run stats`: a compact dashboard, filters and honest tail latency (#366); the same variant compared across GPUs (#348); a frame interpolation is one variant per model and multiplier (#346).
- Output: wait for a folder another program holds open (#369).

### Tests and releases
- Golden snapshots of what the music video and the film send to ComfyUI and ffmpeg (#370).
- `CHANGELOG.md`, and GitHub releases built from it (#349).

## v0.3.0 – two-pass clips, film-look shot planning, a band that plays what is heard

_2026-10-20_

The music video grows up: shot planning that follows the film look and the music, a band that plays what is heard, two-pass clips at 2 MP, 48/60 fps, finishing, an asset library, and render servers that can fail without failing the run. 102 pull requests since v0.2.0 (#143–#344).

### Highlights

- **Two-pass clips at 2 MP** (`h3-ref2video-2pass`): pass 1 with the base model at a quarter of the pixels, the latent upscaled x2, then a 4-step base-model refine. Sharp 1920×1088 clips without the ghosting a single pass at that size gives.
- **Smooth final video**: frame interpolation to 48 or 60 fps (`finalFps`), shot by shot.
- **Finishing** (`finish`): light grade, CAS sharpen, color match of all clips to one reference so the cuts do not jump, optional film grain.
- **Shot planning follows the film look**: style.txt guides the framing, with real close-ups and extreme close-ups. Shot sizes are defined, with a person limit per size.
- **Resumable shot planning**: the blocking is a step of its own, each beat's plan is kept at once, and a stopped run goes on from the planned beats.
- **A band that plays what is heard**: instrument activity from the stems, every heard span, no playing in a silent bridge, real instruments, hands shots, one player per stationary instrument.
- **Lip-sync gaps**: a long silence before or after singing is a clip of its own, and long notes hold one mouth shape.
- **Asset library**: export, import and create characters and places, and say in `casting.json` who plays which role.
- **Several render servers**: a server that goes down is taken out, and its clip goes to another one. Jobs of the run before are resumed first, finished ones are fetched at once.
- **New tools**: `bun run status`, `bun run inspect`, `bun run stats`, `--dry-run` with an estimate, `--review`, and a full log in every project.

### Shot planning

#### Structure and resuming
- The blocking is a step of its own; `--redo=shotMoments` keeps it (#274).
- Blocking of all beats first, then the shots of the beats in parallel (#245); blocking with 8192 tokens, labelled calls in the log (#247).
- Each beat's plan is kept at once - a stopped run goes on from the planned beats (#341).
- A beat without a plan is planned again on the next run (#166).
- The planner writes four shots per call in lines, not a whole beat in nested JSON (#182).
- Rules first, the call's own data last - prefix cache (#238).
- A problem is asked again only for the shots it is in (#239).
- Plan checks that cost no call: the code repairs or notes what it can, and only real breaks are asked again (#168).
- One complete example shot instead of weak/strong pairs (#244).

#### Framing
- The film look is the planner's guide: the framing follows it and what the shot is about (#334).
- What each size class is: an extreme close-up holds one person, a close shot at most two (#342).
- A shot is about at most four people (#166); overfull close and medium shots: the code names who leaves the shot (#294).
- Realistic live action is the default film style, artistic ones the exception (#162).

#### Staging
- The planner sees the place and the people as their pictures show them (#240).
- One fixed layout per location, and the planner stages in it (#241).
- Exact positions of people to one another (#167).
- Directions are said as the picture shows them, not as compass points (#173).
- Every person and every crowd gets their own movement (#164).
- In a shot of three or more people nobody just stands there (#177).
- A singer sings through the action, not to the lens; blows have weight (#170).
- Fights are an exchange (#164) and a melee where everybody in the picture takes part (#171).
- `fightClips`: the clips of a fight beat are cut into one-bar pieces with their own people as references (#174), and each piece names only the people it has pictures for (#194).
- Being heard puts nobody in the picture (#284).

#### References and facts
- Planner fields instead of word lists (#180), plus Fountain import, per-element persistence and RenderSpec (#185).
- `{Name}` tokens in the LLM's text instead of matching names with regular expressions (#242).
- Continuity: a fact belongs to the characters or the place it is about (#243).

### Music, band and singers

#### Instruments
- Instrument activity: bar-averaged energy against the stem's own playing level (#249).
- Track definitions: every span an instrument is heard in, held still between them (#326).
- An instrument heard for part of a shot plays only then (#286), also when heard only at the start and the end (#305).
- Who plays and who sings, per shot, checked by flags (#257).
- `playing:` says what the hands do, and the playing sentence is always added (#264).
- The LLM reads whether a heard player's hand phrase plays at all (#272).
- Instruments are named and drawn as the real instruments they are (#307).
- Shots of a player's hands on the instrument (#309).
- Without a drummer in the picture, bass and guitar get a track each (#311).
- Players who do not fit share one mix of their stems (#259).
- A player of a stationary prop is only ever at it: one person, not also the standing figure of the picture (#328).

#### Props and hands
- Cast field `hands`: what a character holds and plays with - nobody is given hands the story does not give them (#330).
- A carried prop is shown in use, hands named, checked by the LLM (#324).
- Props are shown the way they are held while used; a prop too big to carry stands in its place (#255).
- The character look prompt gets the prop, a rule for its size, and describes the whole body (#147).
- The prop check accepts the thing a "-style" prop is styled after (#149).
- A place never shows a character's prop (#225).

#### Characters and groups
- Several members of a group in one shot are several pictures, not one (#318).
- A counted party is separate characters with their own props, and a group states how many it is (#143).
- A character a shot shows is in the cast, with its reference picture (#189).
- Named characters get their pictures (#191).
- Singer names in the config are mapped to the cast by the LLM (#187), minding gender (#191).
- Clips say when the reference limit drops characters (#224).

#### Lyrics, timing and lip-sync
- A long silence before or after the singing is a clip of its own, and long notes hold one shape (#316).
- A word matched bars away from its line no longer sets the line's start or end (#268).
- A heading tag and the tags right after it are one section (#261).
- A section without vocals after a sung one starts where those vocals end (#253).
- Story beats: the intensity follows the music along the song (#270).

### Rendering

#### Workflows
- `h3-ref2video-2pass`: base model at a quarter of the pixels, latent x2, short refine (#292). Pass 2 is now the base model again, euler/beta, 4 steps, denoise 0.2, its own noise, no turbo LoRA - the LoRA left a crosshatch on skin (#344).
- `h3-ref2video-full`: the clip workflow without the turbo LoRA (res_multistep, simple, 20 steps) (#287).
- H3 turbo LoRA: euler/simple with the sigma shift, and a note above the recommended size (#251).
- `h3-ref2video-cpu-clip`: the clip workflow with the text encoder on the CPU (#144).
- Kroma image workflow as the default; krea2-image stays selectable (#151).

#### Sizes, frames and continuity
- `videoAspect`: portrait and other aspect ratios for the clips (#298).
- The same clip size on every render server (#296).
- `contextFrames`: a continuing clip starts on the last frames of the clip before (#315).
- Pinned start frame only as a guide, continuity off by default, one view of the place per clip (#176).
- No more shots that come out as the reference pictures lined up on their grey backdrop: retention wording, a place anchor for every group, and a leak check (#175).
- The place anchor is a phrase the LLM writes; "is"/"are" by count (#226).

#### Final video
- Frame interpolation: a 48 or 60 fps final video, interpolated shot by shot (#299).
- `finish`: a light grade and CAS sharpen of the final video (#313).
- `finish`: the clips matched to one reference, and film grain (#317).

#### Render servers
- A server that goes down mid-run is taken out, and its failed clip goes to another one (#332).
- The jobs of the run before get their server first, and a finished one is fetched at once (#301, #336).
- The status board shows a job the server says is running as running, before its first progress event (#338).
- A failed ComfyUI job is queued anew instead of being resumed again and again (#148).
- Paths on the ComfyUI server are split with `/` and refused with `\` before anything is sent (#321, #322) - Linux servers work from Windows.

### Assets and casting
- `import-asset`: take a finished character or place from another project instead of rendering it again (#276).
- Asset library: export a finished character or place and import it into any project (#280).
- `create-asset`: a library character or place from an anchor picture (#281).
- `casting.json`: who plays each role and which picture each place has, from the project or the library (#282).

### CLI, tools and logs
- `bun run status`: steps, changed inputs, renders and the next command (#233).
- `bun run inspect`: one clip's prompt with everything it was made from (#229).
- `bun run stats` with durations, tokens/s, setup capture, a central store and a prediction (#193); bars for the median, colours for the change, aligned token tables (#262).
- `--dry-run`: what `--redo` and `--render` would redo and render, with an estimate (#234).
- `--review`: stop after story, cast, look and beats to accept, edit or redo them (#230).
- `--debug` shows the stack trace of a failure (#222).
- No default project for the author: pick one, or list them (#223).
- Compact output: a cached step is one line, details only for what is new (#236), and a summary at the end of every run (#237).
- Every run writes its full log into the project (#235).
- Plan runs keep the previous clip requests and list which changed (#228).
- Init: without lyrics nobody can sing - it says so, and how to get out of the alignment error (#196).

### LLM
- Independent calls run in parallel, up to `llm.parallel` (#227).
- Answers in a JSON schema where the server supports it (#232).
- Reasoning level "none": thinking off for the view picks, anchors and summary (#266).
- The second try after a cut-off answer is the shorter-thinking prompt, not the same prompt with twice the room (#195).

### Film pipeline
- Coverage prompt with the rules first and the scene's data last - prefix cache (#231).

### Code reviews and docs
- Findings of the first code review fixed (#179).
- Second code review: render provenance, plan invariants, source fidelity, state (#183).
- README and docs/ brought up to date with the code (#303).
- The asset tools at a glance (#312).
- Two-pass sizes: `videoResolution` is the final size, pass 1 a quarter of it (#314).
- Finishing: color match, grade, sharpen and grain, with examples (#319).

## v0.2.0 – short-film pipeline, staged music-video shots

_2026-10-09_

A second pipeline next to the music video: an idea or screenplay becomes a short film, rendered through ComfyUI. The music-video planner gets staged shots.

### Short-film pipeline (new)
- Idea or screenplay → screenplay, cast and locations; film look chosen from a built-in style list; reference pictures per character, look (state) and location.
- Shot planning: fewer, better shots per scene; camera position, positions of everyone at the start, what moves during a shot, who faces whom, held shots for talking close-ups; conversations keep the listener in the picture (shoulder in the foreground); fights written as exchanges; scene-to-scene continuity (positions, camera side).
- A script ledger (begins, changes, setups) and a contradiction check that repairs the script in rounds (`--fix-script` for a screenplay).
- Dialogue: every line has a language and a delivery; long lines are spoken over several shots; voices of the cast must be told apart; cutaways and voice-overs leave the speaker out of the picture.
- Clip rendering with H3 reference-to-video (`imageWorkflow` / `videoWorkflow` in the film's `config.json`, incl. `h3-ref2video-film-beta` without the turbo LoRA); chained clips start from the real last frame.
- Assembling (`--render=final`) with subtitles (script translations or a configured language, optional burn-in), level matching between clips and an optional score that ducks under the dialogue.
- Optional designed location views (`locationViews`): the five views of a location sheet are designed for the place and its story.
- `--again` re-renders named clips with a new seed and keeps the old version; `--redo=coverage --scenes=s6,s7` plans single scenes again.
- Tools: `bun run film:replace-character`, `film:gallery` (every film on one page), `film:migrate` (renumbered clips), timeline export as an edit decision list (EDL).
- Docs: quick start with the commands, subtitles, score, levels, long lines, fights.

### Music video
- Staged shots (floor plan, who is in each shot, where they stand and move) instead of a fixed row; a species has one look; a character's prop is one specific object, the one the story names first.
- Clips are cut where as few sung words as possible are cut in two; the lead sings the verses, a group joins for the refrains.
- New `singerVoice` option (auto/female/male/mixed): story, cast and singer pick follow the song's voice.
- Clips of a continuous beat start on the previous clip's last frame (`pinStartFrame`, on by default); story beats are spread over the song's time instead of its lyric sections.
- The clip workflow loads the Ref2V turbo LoRA (it was the FL2V one).
- Shot planner: every fact once, relations between people, no measures or anatomy; the clip prompt says "the place stays as it is" instead of listing windows, doors and mirrors.
- Whisper: repeat-loops dropped, heard ad-libs kept as lip-sync lines, a second pass only replaces the words it overlaps and is sure of.

### Fixes and robustness
- Singer assignment: token budget sized from the line count (#124).
- LLM answers: empty answers retried, missing or wrong closing brackets repaired, a closer too many left out.
- The final video is named after the project.
- Tests for the pure film parts and for `ask`/`askJson` against a fake LLM server.

## v0.1.0 – first release

_2026-10-01_

Turns a song (lyrics + audio) into a beat-matched music video plan and renders it through ComfyUI (Krea 2 reference pictures, MiniMax H3 reference-to-video clips).

### Pipeline
- Multi-track audio is the standard: separated stems (vocals, instruments, drums anchor) go into the video as `<Audio N>` references, and the full mix is locked in additionally via `MiniMaxH3AddGuide`.
- `--render=song` generates the song with YuE2. `song.mp3`/`flac` are accepted as input.
- Reference sheets with facial expressions, group-character variants and multi-angle views (sequence sheets).
- Better prompting: shot continuity, blocking and camera variety, idle-prop phrasing for stationary instruments, lip-sync against the vocals.

### CLI and tools
- `bun run init`: interactive project creation, with a step-by-step tutorial and an ASCII banner.
- Interactive tool to replace a character's picture and description.
- `--gallery`: static HTML overview of a project's assets.
- `--export`: timeline for Shotcut/Kdenlive (`.mlt`) and OpenShot (`.osp`).
- `--redo` rejects unknown step names.

### Robustness
- Timeouts and friendly errors for ComfyUI, missing tools and hung helper calls.
- `project.json` is written atomically; `config.json` and the project id are validated.
- Warnings when clips don't tile the song or a section gets no clip.
- Clips with a different frame rate are resampled when assembling; gaps between clips are kept in the MLT export.
- Reference audios are capped at 3 (the node's real limit), and the anchor track is kept on overflow (#86).

### Documentation
- Tutorial, guide for reusing your own anchor image, CUDA/PyTorch/demucs notes.
