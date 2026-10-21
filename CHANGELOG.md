# Changelog

One section per release. The section of a tag becomes its GitHub release (`.github/workflows/release.yml`).

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
