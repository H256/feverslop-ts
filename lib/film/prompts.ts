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
  "scenes": [{"heading": "INT. PLACE - NIGHT", "characters": [""], "summary": "", "purpose": "", "seconds": 20}]
}
- "name": a first name or a short name, as the script will write it. A narrator who is never seen is a character too (name it "Narrator").
- "appearance": concrete and visible - age, build, face, hair, clothing. No personality.
- "voice": how the character sounds, for the video model - gender, age, pitch, timbre, pace, accent. Concrete, e.g. "an older man's low, gravelly voice, slow and calm, a slight northern accent".
- "heading": a slugline - INT. or EXT., the place, DAY/NIGHT/DUSK/DAWN. The same place is always named the same way.
- "summary": what happens, in 2-3 sentences. "purpose": what the scene changes in the story.
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
${outline.scenes.map((s, i) => `${i + 1}. ${s.heading} (${s.seconds}s) - ${s.characters.join(', ') || 'nobody'}\n   ${s.summary}\n   Purpose: ${s.purpose}`).join('\n')}`,
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
        maxTokens: 8192,
        reasoning: 'medium',
        input: `${setting ? `Setting (era and place): ${setting}\n\n` : ''}${problems.length ? `Your last answer left these out - every speaker cue and every slugline place of the screenplay must be covered by an alias:\n${problems.map(p => `- ${p}`).join('\n')}\n\n` : ''}${outline ? `Planning notes (use them for appearance and voice where they cover a character):
${outline.characters.map(c => `- ${c.name}: ${c.role}. ${c.appearance}. Voice: ${c.voice}`).join('\n')}

` : ''}${original ? `The screenplay as its writer handed it in - it may carry a character list or notes (ages, looks) that are facts for the cast:
${original}

---
The same screenplay, structured:
` : 'Screenplay:\n'}${screenplayToText(screenplay)}`,
        instructions: `You are a casting and location director. Read the screenplay and list everyone who appears or speaks in it, and every place it takes place in. Answer only with JSON:
{
  "characters": [{"name": "", "aliases": [""], "role": "", "appearance": "", "voice": "", "voiceOnly": false, "states": [{"name": "", "change": ""}]}],
  "locations": [{"name": "", "aliases": [""], "description": ""}]
}
Characters:
- Only individuals the story follows are characters: someone who speaks, acts on the plot or is looked at and looks back, and who comes back or matters. Extras, crowds, passers-by, ghosts, silhouettes and other background presences are not - they are described in the scene itself, and leaving them out keeps the number of reference pictures small. A character of any kind needs a face and a body to draw.
- "name": the character's name, in English letters where the script allows it.
- "aliases": every cue and name the script uses for this character, exactly as written (e.g. "MARIA", "Maria", "Mother"). One character, one entry - cues that mean the same person belong together. Every speaker cue of the screenplay must be in some character's aliases.
- "role": a short description of what the character does in the story.
- "appearance": concrete and visible, in 1-2 sentences - age, build, face, hair, clothing. Take what the screenplay says and fill the gaps with plain, fitting choices, so the character can be drawn. What the screenplay states is kept exactly (age, size, colors, species, clothing) and never contradicted by a filled-in detail. Age and build are written plainly, as facts. Clothing and gear are named exactly as they were in the setting's era and place - not a vague "uniform" or "robe", which an image model fills with the most familiar one, maybe from another period.
- "voice": for the video model - gender, age, pitch, timbre, pace, accent, as one phrase that fits after "says in": it starts with an article and contains the word "voice", e.g. "a young woman's clear, light voice, fast and a little nervous".
- "voiceOnly": true for a character who is never seen (a narrator, a voice on the phone), else false.
- "states": almost always []. Only if the script changes how the character LOOKS - for a stretch of the film or for the rest of it - in a way a picture has to show: wounded and bloody, in disguise, covered in mud or soot, soaked, in other clothes, much older. Each: "name" (a word or two, e.g. "wounded") and "change" - what is different from the normal appearance, concrete and visible, one or two sentences. At most two per character. A state is how the body and clothes look - never a pose, a place or an action ("lying in a crater", "dying" are the scene, not the look), and never only a detail of one body part: it has to show in a picture of the whole person. A mood, a bruise that is barely visible or a change of a few seconds is not a state.
Locations: each place that can be filmed as one set, in order of appearance. Sluglines name views and moments as much as places: the same place under several names, seen closer or from another side, at another time of day, is one location with all those names as aliases - a new location only where the look is clearly another (a clearing and the dense forest around it, the inside of a hut and its yard). Fewer, clearly different places are better than many that overlap. "aliases" are the names the sluglines use for it. "description": what it looks like, in one or two sentences - what is where, materials, light. No people and no action.`,
    }
}

/** A read-through of the script for what contradicts itself - the planning and the video model can only follow a script that does. */
export function scriptNotesPrompt(screenplay: Screenplay): AskOptions {
    return {
        maxTokens: 4096,
        reasoning: 'medium',
        input: screenplay.scenes.map(scene => [`## ${scene.id} · ${scene.setting}. ${scene.location} - ${scene.time}`, ...scene.elements.map(e => e.type === 'action' ? e.text : `${e.speaker}: ${e.text}`)].join('\n')).join('\n\n'),
        instructions: `You are a script supervisor reading a screenplay in the order of its scenes. List what contradicts itself or does not follow, as it would show on screen: a person who is bound, free, bound again without anything happening in between; who is where (in the hut in one scene, outdoors in the next, with no way there); an object that is somewhere, then somewhere else, or is used before it is picked up; clothing or injuries that appear and vanish; time of day that jumps back; a character who knows or has what they could not. Only real contradictions - not style, and not what the story leaves open on purpose.
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
export function coveragePrompt(scene: Scene, location: FilmLocation, characters: FilmCharacter[], language: string, lookBrief: string, budgetSeconds: number | undefined, maxShots: number, problems: string[] = []): AskOptions {
    let line = 0
    const script = scene.elements.map(element => element.type === 'action'
        ? element.text
        : `D${++line} ${element.speaker}${element.kind === 'voiceover' ? ' (voice-over)' : element.kind === 'offscreen' ? ' (off-screen)' : ''}${element.delivery ? ` (${element.delivery})` : ''}: ${element.text}`).join('\n')
    return {
        maxTokens: 8192,
        reasoning: 'medium',
        input: `${problems.length ? `Your last answer had these problems - fix them:\n${problems.map(p => `- ${p}`).join('\n')}\n\n` : ''}Scene: ${scene.setting}. ${scene.location} - ${scene.time}
Place: ${location.name} - ${location.description}
Characters you may use, exactly as spelled: ${characters.filter(c => !c.voiceOnly).map(c => c.name + (c.states?.length ? ` (other looks: ${c.states.map(s => `"${s.name}" = ${s.change}`).join('; ')})` : '')).join(', ')}
Dialogue language: ${language}
Film look (its camera language is yours too): ${lookBrief}
${budgetSeconds ? `Planned length of this scene: about ${budgetSeconds} seconds.
` : ''}${scene.shot ? `The writer's heading for this scene: ${scene.shot} - the framing the writer wants for it.
` : ''}
${script}`,
        instructions: `You are a film director planning the shots of one scene of a short film. The film is generated clip by clip with an AI video model: a clip is at most ~9 seconds long and holds a few shots, every shot lives in one clip and is never split.
Plan the shots for the whole scene, in order. Every action and every dialogue line of the scene appears in exactly one shot - none dropped, none repeated, in the order of the script. Show only what the scene contains: no people, creatures, events or lines that the script does not put there - a scene without people shows none, a place is shown as a place. Every shot keeps to the staging: a person does not change posture, place or clothing from one shot to the next unless the action says that they do - and then says how - and the camera positions are ones that can really see the staging (no impossible angles). A shot shows something new - a new action, a person, a detail of the place, or a line of dialogue: never plan a second shot of what an earlier one already shows, and atmosphere (mist, rain, noise) is one shot, not several. This scene has material for at most ${maxShots} shot${maxShots > 1 ? 's' : ''} - fewer is better; a scene with no people and no dialogue is one long shot of up to 8 seconds with a slow camera move. A fast action sequence (see "fast") is the exception: up to 6 shots however short its script is - the script says what happens, the shots show how it unfolds, beat by beat; nothing else happens and nothing comes out differently. Nobody speaks words in a shot unless it is one of the numbered dialogue lines: an action that has someone speak without a line makes the video model invent words. Voices, whispers, chanting or cries that the script itself describes are written as indistinct, wordless sounds. The dialogue lines are numbered D1, D2, ...: list the numbers of the lines spoken in a shot in "lines".

Answer only with JSON:
{"people": true, "voices": false, "fast": false, "soundscape": "", "staging": "", "shots": [{"framing": "", "view": "", "camera": "", "characters": [""], "people": {"<name>": {"state": "", "frame": ""}}, "action": "", "lines": [1], "deliveries": [""], "states": {}, "seconds": 4, "continues": false}]}
- "people": read the script of the scene and say whether anyone is in it - a character, a creature, or people said in general words ("the men", "a crowd"). false for a scene that is only a place: landscape, weather, the sound of guns.
- "voices": true only if the script of the scene itself describes voices that are not numbered dialogue lines - whispering voices, a chant, a spell, a crowd calling, voices in someone's head. Otherwise false.
- "fast": true only if the scene is a fast, forceful action sequence - a fight or duel of any kind (fists, blades, guns, or powers and spells thrown at each other), a battle, a chase, an escape, a fall, a crash, an explosion that hits people. Such a scene is cut on the movement: 3-6 shots of 2-4 seconds each, even if the script gives it one line, and its shots are choreography, see "action". Otherwise false.
- "staging": 2-4 sentences, the fixed layout of the place for this scene - a floor plan every shot keeps to: which features are on which side or wall (the hearth on the far wall, the cot along the left wall, the door behind the camera's first position, the stone in the middle of the clearing), how far apart they are. Nothing that moves in the scene: no people, nothing that anyone picks up, puts down, opens or changes - that is told per shot in "people". Only what the script and the place description give: invent no furniture, objects or clothing.
- "soundscape": 1-3 sentences, the ambience and physical sounds of the scene (wind, rain, footsteps, cloth, breathing). No dialogue, no music.
- "framing": the shot size and angle, e.g. "wide establishing shot", "medium close-up", "over-the-shoulder shot", "extreme close-up insert". Vary them: no more than two of the same in a row, a wide shot where the place matters, close-ups for faces that speak or react. If the writer's heading for the scene names a framing ("CLOSE UP - ANUBIS", "WIDE SHOT"), the shot of this scene has that framing and centres on what the heading names - a close-up of one person shows that person, not both.
- "camera": one natural English sentence with the movement, amplitude and speed ("the camera pushes in slowly", "the camera drifts sideways at walking pace"; in fast action it moves with the action: "handheld, whipping round with the swing", "a quick push-in on the impact"). Every shot is a new camera position: a cut never goes back to the setup of an earlier shot, and never starts the same camera move again from the same place - the shot after a push-in is another angle, another size or another side, not a second push-in from wide. Vary the moves (push-in, drift, pan, tilt, a barely perceptible drift for a face that speaks). When people talk to each other in a place, the place and the other person stay recognizable in every shot: a shot of the one who speaks has the other in the picture (over their shoulder, at the edge of the frame, in the soft foreground, or both in a two-shot), and the other is then in "characters" too. A single close-up with nobody else in the picture is for one key beat at most, never shot after shot - the video model draws a new room for every person alone in a frame. The film look gives the camera its character (handheld, slow, heavy, locked off) - not one movement for every shot: a look that says "slow creep" or "drift" does not mean every shot creeps forward. Within a scene no two shots in a row move in the same direction - after a push-in comes a sideways drift, a pull-back, a tilt, a pan or a hold; most close-ups of a face that speaks hardly move. Where the look asks for a still, locked-off camera, every shot is locked off; otherwise a shot is never fully static, which reads as a photograph.
- "view": where the camera stands in the place and what it looks toward, in the terms of the staging ("from beside the cot, looking across the room toward the hearth wall"). Shots of one scene keep to one side of the line between the people who talk: a reverse shot looks back along that line, never from the other side of the room.
- "characters": the names, exactly as spelled above, of everyone visible in the shot. A voice-over speaker or someone speaking off-screen is not in it. Someone who speaks on screen always is.
- "people": for everyone in the shot's "characters": "state" - where they are and what they do, hold and wear at the START of this shot, as a phrase with a verb ("stands at the shelf with the radio in both hands, wrists free", "sits cross-legged by the cold hearth, knife in her right hand"). It follows from the shot before: whatever its action changed - something picked up or put down, someone freed, moved, hurt - is already so; things before the script has it happen are not. "frame" - how they are in the picture: in focus or soft, where in the frame, from which side ("sharp, left of centre, three-quarter view toward the camera", "foreground right, back and shoulder only, out of focus"). Name only people who are in the shot.
- "action": 1-3 sentences, present tense, what is visible and audible in the shot, naming the characters exactly as spelled above - but only those in the shot's "characters": anyone else is not named (the video model draws a stranger for a name it has no picture for); where a person looks at someone who is not in the shot, say which way they look ("looks off to the left of the frame"). Say which way people turn, what they look at, what the face shows - and the mechanics of any contact, not only its result. The dialogue itself is not repeated here, only what the speaker does while saying it. In a fast action sequence every shot is one or two beats of a choreography, and the people act on each other: who moves first, with what and how fast ("lunges", "whips round", "slams into"), where it lands - what is hit, what gives way, and what the other does in the same moment (blocks, dodges, falls back, strikes back) - and what the hit does to the one who takes it. Opponents do not stand still and face each other while their weapons or powers clash off to the side: the staging is only where the fight begins, then people move through the place, close in, give ground, fall and get up. A power or a weapon is shown by what it does to the other person and to the ground between them: a thrown power leaves the hand or the weapon, travels, hits, and the target is pushed, burned, knocked back or forced to shield - the exchange goes back and forth, each side answering the other, instead of one blast at the end.
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
        instructions: 'You adapt an image prompt. Write the same prompt for the same character in the other look: every word that is not affected by the change stays exactly as it is (face, hair, build, medium, lens, light, background, pose, format), only clothing, condition or details the change touches are rewritten. Answer only with the new prompt.',
    }
}
