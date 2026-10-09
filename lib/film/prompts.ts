// Prompts of the short-film pipeline. Everything is written in English; only dialogue stays in its own language.
// These are separate from lib/prompts.ts on purpose - the music-video prompts are tuned for songs and stay as they are.
import type {AskOptions} from "../llm.ts";
import type {Brief, FilmCast, FilmCharacter, FilmLocation, Outline, Scene, Screenplay} from "./types.ts";
import {screenplayToText} from "./fountain.ts";

// What the video model can actually show - the constraints of the generation, not taste. A clip is at most ~10 seconds
// of one location with a handful of people; speech comes out of the model itself, from the prompt.
const filmableRules = `The film is generated clip by clip with an AI video model (every clip: at most ~10 seconds, one place, a few people), so write for that:
- Tell the story in pictures and short spoken lines. Dialogue lines are short: at most ~15 words, one thought each. A long thought is split between speakers or across a pause with an action.
- Few characters (2-4 is ideal, 6 at the very most) and few locations (1-3 is ideal, 4 at the very most). One location per scene. No crowds - at most a few people at once.
- Every action line is something the camera sees or the microphone hears, in the present tense. No thoughts, no backstory, no "we realize", no mood words without what they look like.
- No text that must be readable on screen (letters, signs, screens, phone messages) - tell it in dialogue or action instead.
- A fight, duel, chase or battle is written as an exchange of 3-6 concrete beats, each on its own action line: who moves first and how, where it lands, how the other answers (blocks, dodges, falls back, strikes back) - the people act on each other, never one clash at the end and never two people standing still while their powers meet.
- Keep track of the state of the story as it is written: where everybody is, whether they are bound, hurt, hold or wear something, what time of day it is. A scene goes on from the state the scene before left. A change - someone freed, something picked up or put down, a wound - happens on screen, in an action line, never as a state that appears between two scenes; and times of day run forward unless a line says that time jumped.
- Mirrors, photographs and screens showing a face are avoided - the video model copies the face into them.`

export function briefPrompt(source: string, mode: Brief['mode'], dialogueLanguage: string | undefined): AskOptions {
    return {
        maxTokens: 4096,
        input: `${mode === 'screenplay' ? 'Screenplay' : 'Story idea'}:
${source}`,
        instructions: `You are a script editor. You are given ${mode === 'screenplay' ? 'a screenplay' : 'a story idea for a short film'} in any language. Answer only with JSON:
{"title": "", "language": "", "logline": "", "genre": "", "tone": "", "setting": ""}
- "title": the film's title - ${mode === 'screenplay' ? 'the screenplay\'s own title if it has one, else a short fitting one' : 'a short fitting title, in the language of the dialogue'}, no quotation marks.
- "language": the ISO 639-1 code of the language the characters ${dialogueLanguage ? `speak: always "${dialogueLanguage}"` : mode === 'screenplay' ? 'speak in the screenplay (the dominant one if several)' : 'will speak - the language the idea is written in'}.
- "logline": one sentence in English: who wants what, and what stands in the way.
- "genre", "tone", "setting": a few words each, in English. The setting is era and place.`,
    }
}

export function outlinePrompt(idea: string, brief: Brief, targetSeconds: number): AskOptions {
    const duration = targetSeconds > 0
        ? `The finished film runs about ${targetSeconds} seconds. Plan the scenes so their "seconds" add up to that: roughly one scene per 15-30 seconds.`
        : 'The film is as long as the story needs, but a short film: 1-3 minutes.'
    return {
        maxTokens: 8192,
        reasoning: 'medium',
        input: `Story idea:
${idea}

Title: ${brief.title}
Logline: ${brief.logline}
Genre: ${brief.genre} · Tone: ${brief.tone} · Setting: ${brief.setting}
Dialogue language: ${brief.language}`,
        instructions: `You are a short-film writer. Plan the film from the story idea: a complete small story with a beginning, a turn and an end - not a scene from the middle of something.
${duration}

${filmableRules}

Answer only with JSON:
{
  "characters": [{"name": "", "role": "", "appearance": "", "voice": ""}],
  "scenes": [{"heading": "INT. PLACE - NIGHT", "characters": [""], "summary": "", "purpose": "", "begins": "", "changes": "", "seconds": 20}],
  "setups": [{"event": "", "setup": ""}]
}
- "name": a first name or a short name, as the script will write it. A narrator who is never seen is a character too (name it "Narrator").
- "appearance": concrete and visible - age, build, face, hair, clothing. No personality.
- "voice": how the character sounds, for the video model - gender, age, pitch, timbre, pace, accent. Concrete, e.g. "an older man's low, gravelly voice, slow and calm, a slight northern accent".
- "heading": a slugline - INT. or EXT., the place, DAY/NIGHT/DUSK/DAWN. The same place is always named the same way.
- "summary": what happens, in 2-3 sentences. "purpose": what the scene changes in the story.
- "begins": where everybody in the scene is and in what state at its start: bound or free, hurt, what they hold or wear, and the time of day. It is what the scene before left - the same, unless that scene's "changes" say otherwise. The first scene gives the starting state.
- "changes": what happens in the scene, on screen, that changes a state: someone is freed, something is picked up or put down, someone is hurt, someone goes to another place. "nothing" if nothing does. Every change is something the camera can see - no state ever changes between two scenes. Times of day run forward unless the story jumps in time.
- "setups": for every event that has to be believable (an escape, a surprise, an object that is used), what has to be shown before it and in which scene - an escape from a rope needs the rope shown, and what makes it give way. [] if nothing needs it.
- If the idea lists the steps of the story (an arc, beats, an ending), every step happens, in that order, in a scene of its own or inside one: none dropped, none reordered, no other ending.
Names, headings and the story are written in English; the dialogue language only matters later, in the script.`,
    }
}

const screenplayJson = `{
  "scenes": [{
    "setting": "INT",
    "location": "",
    "time": "NIGHT",
    "shot": "",
    "elements": [
      {"type": "action", "text": ""},
      {"type": "dialogue", "speaker": "", "text": "", "kind": "spoken", "delivery": "", "language": "", "translation": ""}
    ]
  }]
}
- "setting": "INT", "EXT" or "INT/EXT". "location": the place as the slugline names it, without INT./EXT. and without the time. "time": DAY, NIGHT, DUSK, DAWN, ...
- "speaker": the character cue, as the script writes it. "kind": "spoken" (the character is in the picture and speaks), "offscreen" (heard, but not in the picture) or "voiceover" (narration or thoughts, lips closed).
- "shot" is optional - only when the heading of the scene names a shot or a view instead of a place: the heading as written, in English ("CLOSE UP - ANUBIS", "WIDE SHOT"). "delivery" is optional - the parenthetical, in English ("whispering", "out of breath"). "translation" is optional - only when the screenplay itself has a translation of the line under it (in brackets): the translation as written. "language" is the ISO 639-1 code of the language the line is spoken in, on every dialogue line: read the words of the line, not who says it - one character may speak two languages in the same film.`

export function screenplayWritePrompt(brief: Brief, outline: Outline): AskOptions {
    return {
        maxTokens: 16384,
        reasoning: 'medium',
        input: `Title: ${brief.title}
Logline: ${brief.logline}
Genre: ${brief.genre} · Tone: ${brief.tone} · Setting: ${brief.setting}
Dialogue language: ${brief.language}

Characters:
${outline.characters.map(c => `- ${c.name}: ${c.role}. ${c.appearance}. Voice: ${c.voice}`).join('\n')}

Scenes:
${outline.scenes.map((s, i) => `${i + 1}. ${s.heading} (${s.seconds}s) - ${s.characters.join(', ') || 'nobody'}\n   ${s.summary}\n   Purpose: ${s.purpose}${s.begins ? `\n   Starts with: ${s.begins}` : ''}${s.changes && s.changes.toLowerCase() !== 'nothing' ? `\n   Changes on screen: ${s.changes}` : ''}`).join('\n')}${outline.setups?.length ? `\n\nSetups - what has to be shown before a later event:\n${outline.setups.map(u => `- ${u.event}: ${u.setup}`).join('\n')}` : ''}`,
        instructions: `You are a screenwriter. Write the screenplay for this outline - every scene of it, in order, with the same characters and places.

${filmableRules}
- All dialogue is written in the dialogue language (${brief.language}) - natural, spoken, with the character's own voice. Action lines and deliveries are English.
- Each scene's length matches its planned seconds: about 2.5 spoken words per second plus the time of its actions.
- Write only what the outline contains - no new characters, no new places.

Answer only with JSON in this format:
${screenplayJson}`,
    }
}

export function screenplayParsePrompt(source: string, language: string, missing: string[] = []): AskOptions {
    return {
        maxTokens: 24576,
        reasoning: 'low',
        input: `${missing.length ? `Your last attempt changed or lost these dialogue lines - they must appear exactly as in the screenplay, character for character:\n${missing.map(m => `- ${m}`).join('\n')}\n\n` : ''}Screenplay:
${source}`,
        instructions: `You are a script supervisor. Convert the screenplay into structured JSON. Do not rewrite it.
- Every dialogue line is copied verbatim: the same words, in the same language, with the same spelling and punctuation. Never translate, correct, shorten or reword it. A line spoken in a different language than ${language} gets "language" set to its ISO 639-1 code.
- Keep every scene and every line, in order. Do not invent or drop scenes, characters or lines.
- Action lines are kept in meaning; they may be tidied into plain present-tense sentences in English. Transitions (CUT TO:, FADE OUT) and camera directions of the writer are dropped.
- Sluglines in any language (INNEN, INT., EXT., 内...) become "setting" "INT", "EXT" or "INT/EXT", "location" and "time" - location and time translated into English, the place always named the same way. A heading that names a shot or a view instead of a place ("CLOSE UP - HIS FACE", "WIDE SHOT", "THE COLLISION") is not a new place: the scene stays where the scene before it was, at the time it had - "location" and "time" are those of the scene before, never "unknown".
- A parenthetical becomes "delivery" in English. (V.O.) and (O.S.) / (OFF) become "voiceover" and "offscreen".
- "speaker" is the character cue exactly as written.
- Markdown around the text (**bold**, *italics*, headings, "SCENE 3" labels) is formatting, not part of the screenplay: it is left out of the lines and the scenes. A parenthesised translation of a spoken line, in another language, on the line after it, is not spoken and not a delivery - it is the line's "translation", never part of its text. A parenthetical before a line stays the delivery.

Answer only with JSON in this format:
${screenplayJson}`,
    }
}

// original: the screenplay as it was handed in - the structured one keeps only scenes and lines, so a character list
// ("ELIAN (30s): an exhausted wanderer") and other notes of the writer would be lost
export function castPrompt(screenplay: Screenplay, outline?: Outline, problems: string[] = [], original?: string, setting?: string): AskOptions {
    return {
        maxTokens: 12288,
        reasoning: 'medium',
        input: `${setting ? `Setting (era and place): ${setting}\n\n` : ''}${problems.length ? `Your last answer left these out - every speaker cue and every slugline place of the screenplay must be covered by an alias:\n${problems.map(p => `- ${p}`).join('\n')}\n\n` : ''}${outline ? `Planning notes (use them for appearance and voice where they cover a character):
${outline.characters.map(c => `- ${c.name}: ${c.role}. ${c.appearance}. Voice: ${c.voice}`).join('\n')}

` : ''}${original ? `The screenplay as its writer handed it in - it may carry a character list or notes (ages, looks) that are facts for the cast:
${original}

---
The same screenplay, structured:
` : 'Screenplay:\n'}${screenplayToText(screenplay, true)}`,
        instructions: `You are a casting and location director. Read the screenplay and list everyone who appears or speaks in it, and every place it takes place in. Answer only with JSON:
{
  "characters": [{"name": "", "aliases": [""], "role": "", "appearance": "", "voice": "", "voiceOnly": false, "states": [{"name": "", "change": "", "from": 1}]}],
  "locations": [{"name": "", "aliases": [""], "description": ""}]
}
Characters:
- Only individuals the story follows are characters: someone who speaks, acts on the plot or is looked at and looks back, and who comes back or matters. Extras, crowds, passers-by, ghosts, silhouettes and other background presences are not - they are described in the scene itself, and leaving them out keeps the number of reference pictures small. A character of any kind needs a face and a body to draw.
- "name": the character's name, in English letters where the script allows it.
- "aliases": every cue and name the script uses for this character, exactly as written (e.g. "MARIA", "Maria", "Mother"). One character, one entry - cues that mean the same person belong together. Every speaker cue of the screenplay must be in some character's aliases.
- "role": a short description of what the character does in the story.
- "appearance": concrete and visible, in 1-2 sentences - age, build, face, hair, clothing - as the film first shows the character: whatever the script changes later (hair that grows, clothes that tear, a wound) is only in "states", never in "appearance". Only what the character always has on or with them belongs to it (clothing, a signature weapon or tool) - not an object that turns up in one scene (a phone they check, a cup, a letter): those belong to the shots. Take what the screenplay says and fill the gaps with plain, fitting choices, so the character can be drawn. What the screenplay states is kept exactly (age, size, colors, species, clothing) and never contradicted by a filled-in detail. Age and build are written plainly, as facts. Clothing and gear are named exactly as they were in the setting's era and place - not a vague "uniform" or "robe", which an image model fills with the most familiar one, maybe from another period.
- "voice": for the video model - gender, age, pitch, timbre, pace, accent, as one phrase that fits after "says in": it starts with an article and contains the word "voice", e.g. "a young woman's clear, light voice, fast and a little nervous". The voices of the characters must be told apart by ear, with no model but these words: no two share the same pitch, texture and pace - give each its own pitch (high, middle, low), a texture (smooth, rough, breathy, nasal, hoarse, silky) and a pace, and where two are the same sex and age, make them differ in all three and in accent.
- "voiceOnly": true for a character who is never seen (a narrator, a voice on the phone), else false.
- "states": almost always []. Only if the script changes how the character LOOKS - for a stretch of the film or for the rest of it - in a way a picture has to show: wounded and bloody, in disguise, covered in mud or soot, soaked, in other clothes, much older. Each: "name" (a word or two, e.g. "wounded"), "from" (the number of the scene, as in the [Scene n] headings of the screenplay, in which the script FIRST shows this look - not earlier: a look the script gives in scene 19 is not used in scene 10) and "change" - what is different from the normal appearance, concrete and visible, one or two sentences, and only what the script itself says changes: other clothes only if the script says so, never invented to fit the mood. At most two per character. A state is how the body and clothes look - never a pose, a place or an action ("lying in a crater", "dying" are the scene, not the look), and never only a detail of one body part: it has to show in a picture of the whole person. A mood, a bruise that is barely visible or a change of a few seconds is not a state.
Locations: the "description" is the place as the film first shows it - what stands there in every scene. Leave out what the script reveals, uncovers, builds, breaks or changes later, and every object that someone picks up, carries, uses or moves (a radio on a shelf, a weapon, a cup) - even when the script's own scene description lists it there: those belong to the shots that need them, not to the place. Each place that can be filmed as one set, in order of appearance. Sluglines name views and moments as much as places: the same place under several names, seen closer or from another side, at another time of day, is one location with all those names as aliases - a new location only where the look is clearly another (a clearing and the dense forest around it, the inside of a hut and its yard). Fewer, clearly different places are better than many that overlap. "aliases" are the names the sluglines use for it. "description": what it looks like, in one or two sentences - what is where, materials, light. No people and no action.`,
    }
}

/** A read-through of the script for what contradicts itself - the planning and the video model can only follow a script that does. */
export function scriptNotesPrompt(screenplay: Screenplay, idea?: string): AskOptions {
    return {
        // thinking and answer share the limit: a long script made the model think through all of it and never answer
        maxTokens: 12288,
        reasoning: 'low',
        input: `${idea ? `Story idea the script was written from:\n${idea}\n\nScreenplay:\n` : ''}${screenplay.scenes.map(scene => [`## ${scene.id} · ${scene.setting}. ${scene.location} - ${scene.time}`, ...scene.elements.map(e => e.type === 'action' ? e.text : `${e.speaker}: ${e.text}`)].join('\n')).join('\n\n')}`,
        instructions: `You are a script supervisor reading a screenplay in the order of its scenes. List what contradicts itself or does not follow, as it would show on screen: a person who is bound, free, bound again without anything happening in between; who is where (in the hut in one scene, outdoors in the next, with no way there); an object that is somewhere, then somewhere else, or is used before it is picked up; clothing or injuries that appear and vanish; time of day that jumps back; a character who knows or has what they could not. Only real contradictions - not style, and not what the story leaves open on purpose.${idea ? ' Also: a step the story idea names that the script does not show, or shows in another order or with another ending.' : ''}
Answer only with JSON: {"notes": ["s5-s7: <what contradicts what, in one sentence>"]}. Name the scenes. At most 8 notes, the ones that matter most for the picture; [] if the script is consistent.`,
    }
}

export function summaryPrompt(screenplay: Screenplay, cast: FilmCast): AskOptions {
    return {
        maxTokens: 4096,
        input: `Cast: ${cast.characters.map(c => c.name).join(', ')}
Places: ${cast.locations.map(l => l.name).join(', ')}

Screenplay:
${screenplayToText(screenplay)}`,
        instructions: 'You are an expert for story summarization. You receive a screenplay and summarize it in a short paragraph, in English, keeping characters and places intact. Answer only with the summary.',
    }
}

// The one style that fits the film: genre, tone, setting and audience decide. No draw and no forced variety - the look has to carry the tone of the film.
export function styleChoicePrompt(brief: Brief, summary: string, styleList: { id: string, name: string }[]): AskOptions {
    return {
        maxTokens: 2048,
        input: `Choose the film style from the list that suits this short film best, for a film generated with AI image and video models.
The look has to carry the tone of the film: genre, tone, setting and audience decide, and the style that fits is the one to choose - even if it is the obvious one, not the most unusual.
Answer only with JSON: {"style": "<style id>", "reason": "<one short sentence>"}

styles:
${styleList.map(s => `- ${s.id}: ${s.name}`).join('\n')}
---
film: ${brief.title} - ${brief.logline}
Genre: ${brief.genre} · Tone: ${brief.tone} · Setting: ${brief.setting}
summary: ${summary}`,
        instructions: 'You are a film director choosing the visual style of a short film. Answer only with the JSON.',
    }
}

// One scene at a time: its shots. The dialogue is numbered so that the answer can be checked against it - every line
// in exactly one shot, in order - and the shots are what the clips are packed from (lib/film/coverage.ts).
/**
 * The five views of a location's reference sheet, designed for the place and for what happens in it. The sheet is made by a video model from
 * the hero picture; left to itself it turns around the same spot and has no idea what the other side of a place holds - so a shot that looks
 * back the other way gets the same background. Here the other sides are written down first, as a floor plan the views belong to.
 */
export function locationViewsPrompt(location: FilmLocation, hero: string, scenes: string): AskOptions {
    return {
        maxTokens: 4096,
        reasoning: 'low',
        input: `Place: ${location.name}
Description: ${location.description}
The hero picture of it (view 1 is this picture): ${hero}

What happens in this place (the people stand where the story puts them - the views have to serve these shots):
${scenes || '(nothing specified)'}`,
        instructions: `You are a production designer. A video model makes a reference sheet of five locked-off views of this place from the hero picture. Design the five views so that every shot of the film can find its background on the sheet.
First think of the place as a floor plan: what lies on which side of the spot the hero picture looks from, and what lies behind that spot. Then write the views:
- View 1 is the hero picture itself.
- View 2 is the reverse: the camera stands where view 1 looks to and looks back toward the spot view 1 was taken from - what lies behind the camera of view 1, and the features of view 1 seen from the other side.
- Views 3 and 4 look along the place from its two sides (the line between the two sides of the story, where people face each other, seen from the side).
- View 5 is a wide, slightly raised view of the whole place.
Answer only with JSON: {"views": [{"name": "", "shows": ""}, ...five entries]}
- "name": short - where the camera stands and what it looks toward ("from the water side, looking back toward the dunes").
- "shows": one or two sentences - the camera position and what is seen: the features, their materials, where the light comes from, what is on the left and on the right of the frame. Same place, same time of day and weather as the hero picture, nothing that contradicts the description; features that appear in more than one view are in the same place relative to each other. No people.`,
    }
}

export function coveragePrompt(scene: Scene, location: FilmLocation, characters: FilmCharacter[], language: string, lookBrief: string, budgetSeconds: number | undefined, maxShots: number, problems: string[] = [], before?: { scene: string, ends: Record<string, string>, view?: string }, views?: { name: string, shows: string }[]): AskOptions {
    let line = 0
    const script = scene.elements.map(element => element.type === 'action'
        ? element.text
        : `D${++line} ${element.speaker}${element.kind === 'voiceover' ? ' (voice-over)' : element.kind === 'offscreen' ? ' (off-screen)' : ''}${element.delivery ? ` (${element.delivery})` : ''}: ${element.text}`).join('\n')
    return {
        maxTokens: 16384,
        reasoning: 'medium',
        input: `${problems.length ? `Your last answer had these problems - fix them:\n${problems.map(p => `- ${p}`).join('\n')}\n\n` : ''}Scene: ${scene.setting}. ${scene.location} - ${scene.time}
Place: ${location.name} - ${location.description}
${views?.length ? `The picture of the place is a sheet of views: ${views.map((v, i) => `${i + 1}. ${v.name}`).join('; ')}. Every shot gets the number of the view that is its background ("placeView").\n` : ''}Characters you may use, exactly as spelled: ${characters.filter(c => !c.voiceOnly).map(c => c.name + (c.states?.length ? ` (other looks: ${c.states.map(s => `"${s.name}" = ${s.change}${s.from ? ` - from scene ${s.from} on` : ''}`).join('; ')})` : '')).join(', ')}
Dialogue language: ${language}
Film look (its camera language is yours too): ${lookBrief}
${before ? `The scene before (${before.scene}) ended like this - if this scene goes on from it (same place, no jump in time), everybody starts where it left them: ${Object.entries(before.ends).map(([name, where]) => `${name} ${where}`).join('; ')}.${before.view ? ` Its last shot was taken ${before.view} - a shot of the other person in the same place looks back the other way along the line between them, so the people keep their sides: whoever stood on the left of the frame stays on that side of the place, and a reverse shot shows the opposite side of the place behind the person it is taken of.` : ''}\n` : ''}
${budgetSeconds ? `Planned length of this scene: about ${budgetSeconds} seconds.
` : ''}${scene.shot ? `The writer's heading for this scene: ${scene.shot} - the framing the writer wants for it.
` : ''}
${script}`,
        instructions: `You are a film director planning the shots of one scene of a short film. The film is generated clip by clip with an AI video model: a clip is at most ~9 seconds long and holds a few shots, every shot lives in one clip and is never split.
Plan the shots for the whole scene, in order. Every action and every dialogue line of the scene appears in exactly one shot - none dropped, none repeated, in the order of the script. Show only what the scene contains: no people, creatures, events or lines that the script does not put there - a scene without people shows none, a place is shown as a place. Every shot keeps to the staging: a person does not change posture, place or clothing from one shot to the next unless the action says that they do - and then says how - and the camera positions are ones that can really see the staging (no impossible angles). A shot shows something new - a new action, a person, a detail of the place, or a line of dialogue: never plan a second shot of what an earlier one already shows, and atmosphere (mist, rain, noise) is one shot, not several. This scene has material for at most ${maxShots} shot${maxShots > 1 ? 's' : ''} - fewer is better; a scene with no people and no dialogue is one long shot of up to 8 seconds with a slow camera move. A fast action sequence (see "fast") is the exception: up to 6 shots however short its script is - the script says what happens, the shots show how it unfolds, beat by beat; nothing else happens and nothing comes out differently. Nobody speaks words in a shot unless it is one of the numbered dialogue lines: an action that has someone speak without a line makes the video model invent words. Voices, whispers, chanting or cries that the script itself describes are written as indistinct, wordless sounds. The dialogue lines are numbered D1, D2, ...: list the numbers of the lines spoken in a shot in "lines".

Answer only with JSON:
{"people": true, "voices": false, "fast": false, "soundscape": "", "staging": "", "ends": {"<name>": ""}, "shots": [{"framing": "", "view": "", "camera": "", "hold": false, "cutaway": false, "placeView": 1, "characters": [""], "people": {"<name>": {"state": "", "frame": "", "facing": "", "foreground": false, "motion": ""}}, "action": "", "lines": [1], "deliveries": [""], "states": {}, "seconds": 4, "continues": false}]}
- "people": read the script of the scene and say whether anyone is in it - a character, a creature, or people said in general words ("the men", "a crowd"). false for a scene that is only a place: landscape, weather, the sound of guns.
- "voices": true only if the script of the scene itself describes voices that are not numbered dialogue lines - whispering voices, a chant, a spell, a crowd calling, voices in someone's head. Otherwise false.
- "fast": true only if the scene is a fast, forceful action sequence - a fight or duel of any kind (fists, blades, guns, or powers and spells thrown at each other), a battle, a chase, an escape, a fall, a crash, an explosion that hits people. Such a scene is cut on the movement: 3-6 shots of 2-4 seconds each, even if the script gives it one line, and its shots are choreography, see "action". Otherwise false.
- "ends": for every character in the scene, where they are and what they do, hold and wear when the scene is over, as a phrase with a verb ("stands at the boundary ten paces from Hades, staff in both hands"). The next scene starts from it.
- "staging": 2-4 sentences, the fixed layout of the place for this scene - a floor plan every shot keeps to: which features are on which side or wall (the hearth on the far wall, the cot along the left wall, the door behind the camera's first position, the stone in the middle of the clearing), how far apart they are. Nothing that moves in the scene: no people, nothing that anyone picks up, puts down, opens or changes - that is told per shot in "people". Include the sky: where the sun, the moon or an eclipse stand in relation to the features of the place ("the eclipse hangs above the temples, upper right"), fixed for the scene - it does not move between shots. Only what the script and the place description give: invent no furniture, objects or clothing.
- "soundscape": 1-3 sentences, the ambience and physical sounds of the scene (wind, rain, footsteps, cloth, breathing). No dialogue, no music.
- "framing": the shot size and angle, e.g. "wide establishing shot", "medium close-up", "over-the-shoulder shot", "extreme close-up insert". Vary them: no more than two of the same in a row, a wide shot where the place matters, close-ups for faces that speak or react. If the writer's heading for the scene names a framing ("CLOSE UP - ANUBIS", "WIDE SHOT"), the shot of this scene has that framing and centres on what the heading names - a close-up of one person shows that person, not both.
- "camera": one natural English sentence with the movement, amplitude and speed ("the camera pushes in slowly", "the camera drifts sideways at walking pace"; in fast action it moves with the action: "handheld, whipping round with the swing", "a quick push-in on the impact"). Every shot is a new camera position: a cut never goes back to the setup of an earlier shot, and never starts the same camera move again from the same place - the shot after a push-in is another angle, another size or another side, not a second push-in from wide. Vary the moves (push-in, drift, pan, tilt, a barely perceptible drift for a face that speaks). When people talk to each other in a place, the place and the other person stay recognizable in every shot: a shot of the one who speaks has the other in the picture (over their shoulder, at the edge of the frame, in the soft foreground, or both in a two-shot), and the other is then in "characters" too. A single close-up with nobody else in the picture is for one key beat at most, never shot after shot - the video model draws a new room for every person alone in a frame. The film look gives the camera its character (handheld, slow, heavy, locked off) - not one movement for every shot: a look that says "slow creep" or "drift" does not mean every shot creeps forward. Within a scene no two shots in a row move in the same direction - after a push-in comes a sideways drift, a pull-back, a tilt, a pan or a hold; in a shot where someone speaks the camera is held - locked off, or only the breathing of a handheld camera, no push-in, pull-out or tracking: the video model turns a camera that travels toward a person into that person walking toward the camera, and the other person leaves the picture. A close-up of a person who stands far from the other one is a long lens - the distance between the two does not change and nobody steps closer to make the picture. The other person, the listener, is then the foreground: over their shoulder, their shoulder and the back of their head at the edge of the frame, out of focus but readable - never a small figure far away in the background. Where the look asks for a still, locked-off camera, every shot is locked off; otherwise a shot is never fully static, which reads as a photograph.
- "hold": true for a shot in which everybody stays where they are and the camera does not move - a talking close-up or two-shot; the clip then says how the picture stays (same framing, same size of the face, from the first frame to the last), because the video model otherwise lets the camera zoom in and the person walk toward it. false for every shot in which someone walks, fights or the camera moves.
- "cutaway": true for a shot that shows hands, an object or a place while a line of someone who is NOT in the picture is heard (an insert on the jar while she speaks): its "characters" leave the speaker out and the line is spoken off-screen. A person who speaks on screen is always shown - a close-up insert of hands or an object is never the shot of a line that the speaker has to be seen speaking; a long line (more than about 6 seconds) is not left on a cutaway for its whole length. false otherwise.
- "view": where the camera stands in the place and what it looks toward, in the terms of the staging ("from beside the cot, looking across the room toward the hearth wall"). Shots of one scene keep to one side of the line between the people who talk: a reverse shot looks back along that line, never from the other side of the room. A person's face is seen from the side they look toward: if A looks at B, the shot of A's face is taken from B's side - B is then behind the camera, or only a shoulder in the foreground - never from A's own side with B standing in the background. Two people who face each other are shown from opposite sides, and what lies behind each of them is what lies on that side of the place; the distance between them stays the same in every shot. A person who sits or stands at a feature of the place (the hearth, a door, a window, a table) is in the picture only when the camera looks toward that feature - a feature behind the camera is not in the picture, and nobody can be seen at it: move the camera to the other side of them, or place them elsewhere.
- "placeView": only when the place has a sheet of views (listed above): the number of the view that shows what is behind the person the camera looks at - a shot and its reverse shot never have the same number; the number matches "view": the view that shows the same camera position - the same side of the place, the same height (an elevated view only for a camera that is high above, a low view for a camera at the ground). "view" and the numbered view must never contradict each other; if no view fits the camera position you wrote, change "view" to the position of the closest one.
- "characters": the names, exactly as spelled above, of everyone visible in the shot (two people who talk to each other in one place are both in every shot of their conversation: the speaker, and the listener as a shoulder or the back of the head in the foreground - a shot of one of them alone only where the script has the other out of sight) - only those the script has in this scene or has brought in before it: the list above is the whole film's cast, and a character who arrives in a later scene is not in the establishing shot of an earlier one (the film look says where everyone stands in the film, not who is in this scene). A voice-over speaker or someone speaking off-screen is not in it. Someone who speaks on screen always is.
- "people": for everyone in the shot's "characters": "state" - where they are and what they do, hold and wear at the START of this shot (the same single position as their "frame": whoever is a shoulder or the back of a head at the edge of the picture stands right beside or behind the camera, and the "state" says so - never a far place for the state and the foreground for the frame, the video model draws that person twice), as a phrase with a verb ("stands at the shelf with the radio in both hands, wrists free", "sits cross-legged by the cold hearth, knife in her right hand"). It follows from the shot before: whatever its action changed - something picked up or put down, someone freed, moved, hurt - is already so; things before the script has it happen are not. "frame" - how they are in the picture: in focus or soft, where in the frame, from which side ("sharp, left of centre, three-quarter view toward the camera", "foreground right, back and shoulder only, out of focus"). "facing": which way the face is turned in the picture - "left" or "right" (looking toward that side of the frame, in three-quarter view or profile), "camera" (into the lens) or "away" (back to the camera). Someone who talks to a person in the picture looks at them - "left" or "right", never "camera" - and the shot of their face is taken from the listener's side. "foreground": true for a person who is only a shoulder, the back of a head or a part of the body at the near edge of the picture (the listener of an over-the-shoulder shot) - their "state" and "motion" are then not used (a place for them would make the video model draw a second, whole person there); false for everyone else. Name only people who are in the shot. "motion" - what moves during the shot, for each person: the video model lets people walk, step and turn on its own, so say it when they do not: "stays where he stands, only the head and mouth move; does not step forward or back" - or what the movement is, with its direction relative to the others ("takes two steps toward Hades and stops"). People who stand and talk stay where they are; the distance between two people changes only when the action says so.
- "action": 1-3 sentences, present tense, what is visible and audible in the shot, naming the characters exactly as spelled above - but only those in the shot's "characters": anyone else is not named (the video model draws a stranger for a name it has no picture for); an attempt that the script has fail (a rope that does not give, a door that stays shut) is shown failing, and the shot says what stays as it is ("the rope is still tied around his wrists") - the video model otherwise lets the attempt succeed; where a person looks at someone who is not in the shot, say which way they look ("looks off to the left of the frame"). Say which way people turn, what they look at, what the face shows - and the mechanics of any contact, not only its result. The dialogue itself is not repeated here, only what the speaker does while saying it. In a fast action sequence every shot is one or two beats of a choreography, and the people act on each other: who moves first, with what and how fast ("lunges", "whips round", "slams into"), where it lands - what is hit, what gives way, and what the other does in the same moment (blocks, dodges, falls back, strikes back) - and what the hit does to the one who takes it. Opponents do not stand still and face each other while their weapons or powers clash off to the side: the staging is only where the fight begins, then people move through the place, close in, give ground, fall and get up. A power or a weapon is shown by what it does to the other person and to the ground between them: a thrown power leaves the hand or the weapon, travels, hits, and the target is pushed, burned, knocked back or forced to shield - the exchange goes back and forth, each side answering the other, instead of one blast at the end.
- "states": {} unless a character with other looks (listed with the characters above) is in one of them in this shot: {"<character name>": "<look name>"}. A look begins in the shot where the script has it happen (the wound is taken, the disguise put on) and stays in the shots after it, until the script changes it back; a shot before that has the normal look. Not for anyone else.
- "deliveries": one entry per number in "lines", same order - how that line is spoken, in English, from the situation of the script: the feeling and what is behind it, the intensity, the pace ("cold and controlled, every word measured", "a hoarse whisper, afraid to be heard", "shouting over the noise, panicked"). Not the timbre of the voice - that is known. A few words that can be heard: stress, a rise or a drop, a catch in the breath, a pause, anger or fear held back. The video model takes words literally and reads them out, so never "flat", "monotone", "emotionless" or "no urgency" - even a calm or cold character speaks with intent and a pulse of feeling under it ("quiet and cold, with contempt in the last word"). "" only if there are no lines.
- "seconds": 2-8.${budgetSeconds ? ` The seconds of all the shots add up to about the planned length of the scene: fewer, longer shots rather than many short ones, and a place or an action that needs no cut is one shot.` : ''} A shot with dialogue lasts as long as it takes to speak it (about 2.5 words per second) plus a moment for the reaction; at most two lines per shot, then the cut goes to the other person.
- "continues": true only if the shot goes on in the same take as the shot before it, the same camera setup without a cut (the camera follows on). Sparingly - false is the usual.

${filmableRules}`,
    }
}

/** The reference picture prompt of a character in another look: the same prompt with only the change applied. */
export function stateLookPrompt(baseLook: string, name: string, state: { name: string, change: string }): AskOptions {
    return {
        maxTokens: 2048,
        input: `Image prompt of the character ${name}:
${baseLook}

The same character in another look - "${state.name}": ${state.change}`,
        instructions: 'You adapt an image prompt. Write the same prompt for the same character in the other look: every word that is not affected by the change stays exactly as it is (face, hair, build, medium, lens, light, background, pose, format), only clothing, condition or details the change touches are rewritten. Every garment of the outfit stays, head to feet (trousers or skirt, shoes included) - a look that changes the hair keeps the whole outfit. Answer only with the new prompt.',
    }
}

/** The repair of a script that contradicts itself: the smallest changes to action lines and times of day that make it follow. */
export function scriptFixPrompt(screenplay: Screenplay, notes: string[]): AskOptions {
    return {
        maxTokens: 8192,
        reasoning: 'medium',
        input: `Contradictions found:
${notes.map(n => `- ${n}`).join('\n')}

Screenplay (scene ids, action lines numbered by their place among the elements of the scene):
${screenplay.scenes.map(scene => [`## ${scene.id} · ${scene.setting}. ${scene.location} - ${scene.time}`, ...scene.elements.map((e, i) => e.type === 'action' ? `[${i}] ${e.text}` : `${e.speaker}: ${e.text}`)].join('\n')).join('\n\n')}`,
        instructions: `You are a script doctor. Resolve the contradictions with the smallest changes to the screenplay.
- Dialogue is never changed, and no scene, line or character is added or dropped. You change the text of ACTION lines, and the time of day of a scene.
- A change of state is an event on screen: the person is bound with a rope that is long enough to walk the yard - and the rope is tied to a post; someone is freed because the rope tears; an object is taken down from a shelf by a hand that can reach it. Do not make a contradiction go away by deleting what happens - make it consistent by saying how.
- Keep the voice and the length of the action lines; add a clause or a sentence where it is needed, no more. Times of day run forward unless a line says that time jumped.
Answer only with JSON: {"edits": [{"scene": "s6", "element": 0, "text": "<the whole new action line>"}, {"scene": "s17", "time": "NIGHT"}]} - a "text" replaces the action line [element] of the scene; a "time" replaces the time of day of the scene; both in one edit if both change.`,
    }
}
