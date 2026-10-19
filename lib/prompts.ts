import type {AskOptions} from "./llm.ts";
import type {SingerVoice} from "./config.ts";
import {LOCATION_VIEWS} from "./sequenceSheet.ts";

// The LLM prompt templates for the early song/story/look pipeline steps (index.ts, steps 1-8b) - kept separate from
// the orchestration so the prompt copy can be read and edited without the surrounding pipeline wiring.

// Lyrics only - kept separate from the style prompt so lyrics.txt can be hand-corrected and kept fixed while the
// style (music-style.txt) is redone around it, or vice versa (see songStylePrompt).
// durationSec: an upper bound (config.json songDuration) - the model decides the actual song length, so this only
// shapes how many sections/lines the lyrics get, it doesn't force an exact length
export function songLyricsPrompt(idea: string, language: string, durationSec?: number): AskOptions {
    return {
        maxTokens: 4096,
        input: `Write song lyrics from this idea for a music video, for the YuE2 text-to-music model.
Idea: ${idea}
Language: ${language}
${durationSec ? `Target length: around ${Math.round(durationSec)} seconds - shape the number and length of sections accordingly.\n` : ''}
Rules:
- Section labels in square brackets on their own line: [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Interlude], [Outro]. Blank line between sections.
- Start with a verse or chorus, never a lyric-filled intro.
- 4-6 lines per section, about 30 seconds of singing each.
- Write every repeated chorus out in full - never shorthand like "(repeat chorus)".
- Keep the syllable count identical when a line repeats.
- Nothing but section tags and sung words - no production notes like "(drums build)", no title, no hyphenated syllable forcing.
- Written in ${language}.

Answer only with the lyrics.`,
        instructions: 'You are a songwriter. Answer only with the lyrics, nothing else.',
    }
}

// The YuE2 style/tags prompt for a given (fixed) set of lyrics - written or rewritten around whatever is
// currently in lyrics.txt, so correcting the lyrics by hand and asking for a new style still gets one that fits.
// musicStyle: the optional direction from music-style.txt - a hint to follow, not the final YuE2 caption itself.
export function songStylePrompt(lyrics: string, musicStyle: string, language: string): AskOptions {
    return {
        maxTokens: 2048,
        input: `Write a YuE2 style/tags prompt that fits these song lyrics.
${musicStyle ? `Musical direction to follow: ${musicStyle}\n` : ''}Language: ${language}
---
lyrics:
${lyrics}

Rules:
- Comma-separated tags, in this order: genre, instruments, mood, vocal gender, vocal tone. Order matters - earlier tags get more weight.
- Add a tempo tag (e.g. "88 BPM" or "upbeat") when tempo matters to the song.
- If ${language} isn't English, add it as its own tag (e.g. "Japanese", "Mandarin", "German").
- "No <instrument>" tags exclude an instrument that would otherwise be implied.
- Read like a musician's or producer's description of a playable song, not mood prose.

Answer only with the style prompt.`,
        instructions: 'You are a YuE2 prompt designer. Answer only with the style prompt, nothing else.',
    }
}

/**
 * What config.singerVoice adds to the story, cast and singer prompts ('' for "auto"). The story is told around the
 * singers from its first sentence on, so the cast and every look built on it follow.
 */
export function voiceRules(voice: SingerVoice) {
    if (voice === 'auto') return {story: '', cast: '', pick: ''}
    const who = voice === 'mixed'
        ? 'two singers, one woman and one man (a duet - the lines are split between them or sung together)'
        : `${voice === 'female' ? 'women' : 'men'} - every character who sings is ${voice}`
    return {
        story: `\n- The song is sung by ${who}. Write them as such from the first sentence on (consistent pronouns, no gender change later), whatever the lyrics or the story idea suggest.`,
        cast: `- The song is sung by ${who}. State their gender in the role (e.g. "a young woman who ..."), even if the story text says otherwise. Other characters are not affected.\n`,
        pick: voice === 'mixed'
            ? 'The song is a duet of one woman and one man: pick exactly two singers, one female and one male character.\n'
            : `The song is sung by ${voice === 'female' ? 'women' : 'men'}: every singer you pick must be a ${voice} character.\n`,
    }
}

export function storyPrompt(lyrics: string, storyIdea: string, singerVoice: SingerVoice = 'auto'): AskOptions {
    return {
        input: `
    Take the following Lyrics and Story Idea and craft a story from it.
    Lyrics: ${lyrics || '(none)'}
    Story-Idea: ${storyIdea || '(none)'}
`,
        instructions: `You are a movie story writer. You will be given lyrics and a story idea, either of which may be missing (marked as "(none)").
- If both are given, craft a story that considers both the lyrics and the story idea.
- If only one is given, craft the story based on the one that is present.
- If both are missing, do not write a story. Answer only with: NO STORY${voiceRules(singerVoice).story}`,
    }
}

export function summaryPrompt(storyBase: string): AskOptions {
    return {
        maxTokens: 4096,
        // a shorter retelling, nothing to decide - as good without thinking (tried on tides-of-eternal-flame)
        reasoning: 'none',
        input: `
Summarize the story and try to keep locations and characters intact.
---
story:
${storyBase}
`,
        instructions: 'You are an expert for story summarization. You receive a story and summarize it. Answer only with the summary.',
    }
}

export function castPrompt(storyBase: string, singerVoice: SingerVoice = 'auto'): AskOptions {
    return {
        input: `Here is a story concept.
You need to extract all characters and their role in the story.
Furthermore you need to extract all locations from the story.
Answer only with JSON in this format:
{
    "characters": [{"name": "", "role": "", "prop": "", "propStem": "", "propCarried": true, "propInHand": "", "propPlace": "", "isGroup": false, "alike": false}],
    "locations": [{"name": ""}]
}
The rules for characters are: A character is a person or creature in the story. They have a name and a role. The role is a short description of what the character does in the story, including every fact about how they look that the story itself states (size, species, number of eyes or limbs, colors) - written once, so that every later description agrees with it.
A party, crew, band or family of a countable size that stays together through the story ("the seven", "the three sisters", "the other five", a four-piece band) is never one entry: every member is their own character, with their own name (invent short ones the story does not give), their own role and, where they carry something, their own prop. An image and a video model draw one entry as one person copied several times, so one entry for "the other five" ends up as five identical people. Only an anonymous multitude (a crowd, an army, a village, a pack of creatures, a species) is one "isGroup" entry. As a rule: up to about six named or counted individuals are separate characters.
Additionally, for every character:
- "prop": if the character visibly carries or uses one distinctive physical object throughout the story (a weapon, tool, musical instrument, etc.), name it briefly (e.g. "electric guitar", "iron sword", "drum kit"). It is one specific object, named as exactly what it is ("a hand torch", "a short sword"), never a collective word like "tool", "weapon" or "instrument": an image and a video model fill a vague word with the most familiar object, and "iron tool" becomes a pickaxe. You may invent the object, but if the story or its title names something the characters carry (a torch, a lantern, a map), that is the prop before anything of your own, and it fits the era, the place and the style of the story - a descent into a cave does not make miners of its characters. Companions of one party do not all carry the same object: each gets a different kind of the same family where the story names only one (a hammer, a long-shafted war hammer and a spiked mace-hammer are three different props), so that they are told apart at a glance. The protagonist's prop is the most distinctive and the most striking of them (a named or ornate weapon, an object the story builds up), never the plainest. Every visible member of a band must get their actual instrument here, including drummers and other backing musicians, not just the lead. A musical instrument is named as the real instrument it is, by its everyday name, with at most a word of color or material in front ("a red drum kit", "a jade-green bass guitar") - never turned into another kind of thing ("war-drum kit", "coral-and-obsidian drums", "flame harp"): the video model plays an instrument it knows, and one it does not know it draws as decoration and has the player hit the air. Leave it an empty string if the character carries nothing distinctive.
- "propCarried": true when the character has "prop" on them while using it - in the hands, on a strap, on the back or the belt. false when it is too big or too fixed to be carried and stands somewhere the character goes to use it (a drum kit, an organ, an anvil, a loom). true when "prop" is empty.
- "propInHand": only when "propCarried" is false - what the character holds in the hands while using it (drumsticks, a smith's hammer), or an empty string when they use it with bare hands. An empty string otherwise.
- "propPlace": only when "propCarried" is false - the name of the location, exactly as in your "locations", where it stands. An empty string otherwise.
- "propStem": only when "prop" is a musical instrument whose sound is actually part of the song (i.e. this is a band performing the song on screen) - which layer of the song's audio it belongs to: "drums" for a drum kit, "bass" for a bass guitar, "guitar" for any electric/acoustic guitar, "piano" for piano/keys, "other" for anything else melodic (synth, strings, etc. - only when none of the above fit). Leave it an empty string for a prop that is not a musical instrument, for an instrument that is not actually heard in the song, or whenever the story is not a band performing live.
- "isGroup": true if this entry is an anonymous collective acting as one individual member of a group (e.g. "Orcs", "Miners", "Townspeople", an army, a band's backing dancers) rather than a single named person - several of it can appear on screen at once and nobody in it needs to be recognized again. false for a single person or creature, even a memorable one, and false for each member of a counted party (see above).
- "alike": only for a group ("isGroup" true): true if its members look alike - a species or kind of creature, a pack, a unit in the same uniform: it is then drawn once, with one look. false if its members are recognizably different individuals (a crowd of townspeople, a mob). A species is never a group of different-looking individuals.
${voiceRules(singerVoice).cast}The rules for locations are: List them in order of appearance in the story. A location is a place that can be filmed as one set.
---
story:
${storyBase}
`,
        instructions: 'You are an expert data extractor for Stories. You receive a Story and extract locations and characters from it. Answer only with the extracted data.',
        schema: {
            type: 'object', additionalProperties: false, required: ['characters', 'locations'],
            properties: {
                characters: {type: 'array', minItems: 1, items: {
                    type: 'object', additionalProperties: false, required: ['name', 'role', 'prop', 'propStem', 'propCarried', 'propInHand', 'propPlace', 'isGroup', 'alike'],
                    properties: {name: {type: 'string'}, role: {type: 'string'}, prop: {type: 'string'}, propStem: {enum: ['', 'drums', 'bass', 'guitar', 'piano', 'other']}, propCarried: {type: 'boolean'}, propInHand: {type: 'string'}, propPlace: {type: 'string'}, isGroup: {type: 'boolean'}, alike: {type: 'boolean'}},
                }},
                locations: {type: 'array', minItems: 1, items: {type: 'object', additionalProperties: false, required: ['name'], properties: {name: {type: 'string'}}}},
            },
        },
    }
}

// Shortlist, not a single pick: the code then draws one at random, so the LLM's favorites can't decide the look alone.
export function styleShortlistPrompt(storyText: string, styleList: {id: string, name: string, group?: string}[], count: number): AskOptions {
    return {
        maxTokens: 2048,
        input: `Choose the ${count} film styles from the list that would suit this story or song best, for a music video generated with AI image and video models.
Realistic live action is the default: at least ${Math.ceil(count * 0.6)} of the ${count} are live action looks (filmed, with a real camera and real light - different eras, genres, film stocks or lighting), clearly different from each other, not variations of one look. At most ${Math.floor(count * 0.4)} are another medium (animation, craft/stop-motion, painted/printed), and only if the story or song really asks for it - a story that does not name such a look gets none. Let the story's genre, era, tone and audience decide among the live action looks.
Answer only with JSON: {"styles": ["<style id>", ...]}

styles:
${styleList.map(s => `- ${s.id}: ${s.name}${s.group ? ` [${s.group}]` : ''}`).join('\n')}
---
story or lyrics:
${storyText}`,
        instructions: 'You are a film director choosing the visual style of a music video. Answer only with the JSON.',
        schema: {type: 'object', additionalProperties: false, required: ['styles'], properties: {styles: {type: 'array', minItems: 1, maxItems: count, items: {enum: styleList.map(s => s.id)}}}},
    }
}

const lookRules =`Describe in 120-180 words, as plain prose:
- Format and style: name the medium first and be specific, in terms of how it is shot, drawn or built (e.g. "live action shot on 35mm film", "2D anime in the style of 90s cel animation", "Studio Ghibli hand-painted anime", "Pixar-style 3D animation", "stop-motion with visible puppet seams", "grainy VHS found-footage horror", "neon-soaked cyberpunk live action", "black ink wash drawing", "hand-painted dark fantasy oil painting").
- World: architecture, landscapes, materials and textures of the world, as a still: what is where and how it looks. No change or process words (fading, shrinking, contracting, pulling inward, cracking open, slowly ...) - the video model would animate them on the background; what changes in the story is told elsewhere.
- Color palette and lighting: dominant colors, light sources, contrast, time of day.
- Camera language: typical shot types, lens feel and camera movement (e.g. slow dolly-ins, low-angle wide shots, handheld close-ups).
- Texture: film grain, line work, shading or rendering quality.

Describe visible things, not moods - avoid empty words like "cinematic" or "epic" without saying what they look like.
Answer only with the look description.`

export function lookBriefPrompt(style: string, storySummary: string): AskOptions {
    return {
        maxTokens: 4096,
        input: style
            ? `Design the visual look for a film of the following story. It will be generated with the MiniMax H3 video model.
The director has already chosen the style of the film:
"""
${style}
"""
Keep its medium, its style and every reference it names (artists, films, techniques, eras) exactly as given - never replace, soften or mix it with another style.
Start with that medium and style, then extend it with the world, palette, lighting, camera language and texture, so that every image and video prompt of the film stays consistent. Where the director already decided something (e.g. a palette or the lighting), keep it and only make it more specific.

${lookRules}
---
story:
${storySummary}`
            : `Design the visual look for a film of the following story. It will be generated with the MiniMax H3 video model.
Pick ONE format and style and commit to it - never mix styles.
Choose it from the story's genre, era, tone and audience, not from what merely looks artistic: a thriller or horror story may call for gritty live action or found footage, a fairy tale for hand-painted or stop-motion, a comedy for 3D or 2D animation, a sci-fi story for sleek live action or neon cyberpunk. Painterly looks are one option among many - only choose one when the story really asks for it. Before answering, weigh at least three different formats (e.g. live action, 2D anime, 3D animation, stop-motion, comic, painting) and pick the best fit.

${lookRules}
---
story:
${storySummary}`,
        instructions: `You are a film director and cinematographer who designs the visual language of films for AI video models like MiniMax H3.`,
    }
}

// What a character picture must not leave to the video model: a part of the body that is not described is drawn
// from nothing (bare legs under a vest), and a prop that is not in the picture is redrawn as the most familiar object.
// The prop is shown the way it is held while used, whatever it is: a rule written for weapons ("its head or blade and its
// haft/grip ... hold and swing") drew a guitar held by the neck like a club, a bass like a spear and a drummer with a hand
// drum on a haft, and the video model keeps the pose of the picture. A prop that stands in a place (propCarried false) is
// not in the picture at all - only what is held of it. "The way it is held while used" alone still gave a bass that
// "rests against her waist", hanging neck down with no hand on it - and a bassist who never played in any clip (#323):
// the hands are named, at work on it.
const bodyRules = '- Head to toe: name what covers the torso, the legs and the feet (trousers, skirt, robe, boots ...) - no part of the body is left undescribed, because a video model invents whatever is missing.\n'
type PropOf = { prop?: string, propCarried?: false, propInHand?: string }
const propRule = ({prop, propCarried, propInHand}: PropOf) => !prop ? ''
    : propCarried === false
        ? `- The character uses "${prop}", which stands in a place and is not in this picture: ${propInHand ? `they hold only "${propInHand}", the way they hold it while using it, the hands in their working grip` : 'their hands are empty'}.\n`
        : `- The character carries "${prop}": show exactly that object, at the size such an object really has, described by the parts that kind of object has - never a different kind of object, and never stretched into a pole or staff when it is not one. It is in use in the picture: held in the position it has while it is used, and say where each hand is on it, at work - never resting, hanging down, slung aside, lowered or held by one end at the side.\n`
/**
 * Whether a finished look shows the character's prop in use - read by the LLM, not by a list of words: "rests against her
 * waist", "slung on her back" and "held by the neck at her side" are all the prop at rest, and so is the pose in the picture.
 */
export function propInUsePrompt(look: string, prop: string): AskOptions {
    return {
        label: 'prop in use',
        instructions: `You read the prompt of a reference picture of one character. It is used to make video clips, and the video model keeps the pose of the picture.

Does the picture show "${prop}" in use - held in the position it has while it is used, with the hands on it where they are at work? It is not in use when it rests, hangs, leans, is slung aside, lowered, carried by one end at the side, or no hand is on it, and when the prompt does not say how it is held.

Answer as JSON: "inUse" true or false, and "why" - one short sentence on how the prompt has it held.`,
        input: look,
        maxTokens: 1024,
        schema: {type: 'object', additionalProperties: false, required: ['inUse', 'why'], properties: {inUse: {type: 'boolean'}, why: {type: 'string'}}},
    }
}

// the prop as the character JSON of a look prompt names it: what is in the picture
const propField = ({prop, propCarried, propInHand}: PropOf) => !prop ? {} : propCarried === false ? (propInHand ? {inHand: propInHand} : {}) : {prop}

// otherLooks: the already-designed reference prompts of the rest of the cast (built earlier in the same loop) -
// without them, two characters with a similar role/archetype (e.g. "loyal companion") reliably converge on
// near-identical builds, palettes and wardrobes, which a reference-to-video model then can't tell apart on
// screen and swaps mid-shot. Forcing a comparison against what already exists is what actually spreads them out;
// asking each character to be "distinctive" in isolation does not, since every character looks distinctive alone.
export function characterLookPrompt(lookBrief: string, char: { name: string, role: string } & PropOf, otherLooks: { name: string, look: string }[] = []): AskOptions {
    return {
        input: `
Write a Krea 2 image prompt for a character reference sheet of the given character.
The image must match the film look below - same medium, style, palette and lighting - but it is a clean reference plate, not a film frame: it must be sharp and clearly readable, so leave out anything that would degrade or obscure the detail.
Consider the character's role in the story when designing the look.
${otherLooks.length ? `
The rest of the cast is already designed (below). A video model has to tell these characters apart from a distance, in motion, and even when a described prop or accessory isn't in frame - so this character must be silhouette-distinct from every one of them at a glance: a clearly different build or height, a different hair color/length/style, and a different dominant silhouette element (a cloak, a headpiece, a very different garment shape), not just a different color accent or a different hand-held prop. Where this character's role is similar to one already listed (e.g. both are companions or both are guards), push the divergence harder, not softer.` : ''}

Rules:
- Natural language, one paragraph, 50-100 words.
- Start with the medium and style from the film look (e.g. "35mm film photograph of...", "2D anime illustration of...").
- Describe exactly ONE character, even if the name is plural.
- Full body, standing, facing the camera, in front of a plain grey neutral background, so the image can be reused as a reference.
- Describe only visible details: face, age, build, skin, hair, clothing, materials, colors, accessories, and how the light falls on them.
${bodyRules}${propRule(char)}- Keep the medium/style name itself (e.g. "35mm film photograph"), but never call for film grain, noise, motion blur, chromatic aberration, VHS/scan artifacts or similar degrading texture, even if the film look mentions them - sharp focus and crisp detail throughout.
- No mood labels without visible evidence, no text or lettering in the image.
- Answer only with the prompt.

Film look: ${lookBrief}
Character:
${JSON.stringify({name: char.name, role: char.role, ...propField(char)})}${otherLooks.length ? `
Already-designed cast (for silhouette contrast only - do not copy or borrow their specific colors/props):
${otherLooks.map(o => `- ${o.name}: ${o.look}`).join('\n')}` : ''}`,
        instructions: 'You are an expert character designer who writes prompts for the Krea 2 image model. You answer only with the prompt.',
    }
}

// For a group character (Character.isGroup) with several members visible on screen at once - a distinct-looking
// individual belonging to the same group, contrasted against the group's own already-designed members instead of
// against the rest of the cast (characterLookPrompt's otherLooks). Without this every member renders from the
// same one reference image and reads as the same person duplicated across a shot.
export function characterVariantLookPrompt(lookBrief: string, char: { name: string, role: string } & PropOf, existingMembers: string[]): AskOptions {
    return {
        input: `
Write a Krea 2 image prompt for a character reference sheet of ONE individual member of the group below.
The image must match the film look below - same medium, style, palette and lighting - but it is a clean reference plate, not a film frame: it must be sharp and clearly readable, so leave out anything that would degrade or obscure the detail.

This group already has ${existingMembers.length} other member(s) designed (below, one per line). This new member must be clearly a different individual at a glance - a different build or height, a different face/skin/hair, and at least one different clothing or gear detail - while still visibly belonging to the same group (same role, same general faction dress/gear language, same film look).

Rules:
- Natural language, one paragraph, 50-100 words.
- Start with the medium and style from the film look (e.g. "35mm film photograph of...", "2D anime illustration of...").
- Describe exactly ONE individual, not the group collectively.
- Full body, standing, facing the camera, in front of a plain grey neutral background, so the image can be reused as a reference.
- Describe only visible details: face, age, build, skin, hair, clothing, materials, colors, accessories, and how the light falls on them.
${bodyRules}${propRule(char)}- Keep the medium/style name itself (e.g. "35mm film photograph"), but never call for film grain, noise, motion blur, chromatic aberration, VHS/scan artifacts or similar degrading texture, even if the film look mentions them - sharp focus and crisp detail throughout.
- No mood labels without visible evidence, no text or lettering in the image.
- Answer only with the prompt.

Film look: ${lookBrief}
Group: ${JSON.stringify({name: char.name, role: char.role, ...propField(char)})}
Already-designed members of this same group (for contrast - make this one visibly different from each of them):
${existingMembers.map((look, i) => `- Member ${i + 1}: ${look}`).join('\n')}`,
        instructions: 'You are an expert character designer who writes prompts for the Krea 2 image model. You answer only with the prompt.',
    }
}

// For tools/replace-character.ts: describes a character straight from a user-supplied reference image, instead of
// deriving it from this project's own generated look prompt (characterDescriptionPrompt) - same output shape/rules,
// so the result drops straight into characterDescriptions/characterDescriptionVariants.
export function characterImageDescriptionPrompt(imageDataUrl: string, char: { name: string, role: string }): AskOptions {
    return {
        input: `
The attached image is the reference picture of the character below. Describe what they look like, for a video prompt where they act in many different scenes - so only say what they look like, nothing about the picture itself.

Keep: age, gender, build, skin, face and distinctive marks, hair, every piece of clothing with its materials and colors, accessories and any props they carry.
Leave out: the medium and style (e.g. "35mm film photograph of"), the pose and framing, the background, the lighting, film grain and anything else about the picture rather than the character.

Rules:
- One or two sentences, 30-60 words, starting with the character (e.g. "a woman in her late 30s with ...").
- Only details actually visible in the image - do not invent anything not shown.
- Answer only with the description.

Character: ${JSON.stringify({name: char.name, role: char.role})}`,
        images: [imageDataUrl],
        instructions: 'You are an expert editor who writes character descriptions from a reference image. You answer only with the description.',
    }
}

// For tools/import-asset.ts: a place described straight from its picture - same output shape and rules as
// locationDescriptionPrompt, so the result drops straight into locationDescriptions.
export function locationImageDescriptionPrompt(imageDataUrl: string, name: string): AskOptions {
    return {
        input: `
The attached image is the reference picture of the place below. Describe what the place looks like, for a video prompt where characters act in it and the camera moves freely - so only say what the place looks like, nothing about the picture itself.

Keep: layout, architecture, terrain, materials, props, time of day, weather, light sources and atmosphere like fog, dust or smoke.
Leave out: the medium and style (e.g. "35mm film photograph of"), the camera position and framing, that the place is empty or has no people, film grain and anything else about the picture rather than the place.

Rules:
- One or two sentences, 30-60 words, starting with the place (e.g. "a vaulted stone forge with ...").
- Only details actually visible in the image - do not invent anything not shown.
- Answer only with the description.

Place: ${JSON.stringify(name)}`,
        images: [imageDataUrl],
        instructions: 'You are an expert editor who writes location descriptions from a reference image. You answer only with the description.',
    }
}

export function characterDescriptionPrompt(imagePrompt: string): AskOptions {
    return {
        input: `
Rewrite the image prompt below into a short description of the character itself.
The description defines the character in a video prompt, where the character acts in many different scenes - so it must only say what the character looks like, nothing about the picture.

Keep: age, gender, build, skin, face and distinctive marks, hair, every piece of clothing with its materials and colors, accessories and the props they carry.
Leave out: the medium and style (e.g. "35mm film photograph of"), the pose and framing (e.g. "standing full body facing camera"), the background, the lighting, film grain and anything else about the camera or the image.

Rules:
- One or two sentences, 30-60 words, starting with the character (e.g. "a woman in her late 30s with ...").
- Only details that are in the image prompt - add nothing, change nothing, except: a state stays, a process goes ("walls leaning inward" stays, "the architecture visibly contracts" and "a name slowly fading" are left out or become "a worn carved name"). The place is a fixed set in a video prompt; anything that reads as a change would be animated on the background.
- Answer only with the description.

Image prompt: ${imagePrompt}`,
        instructions: 'You are an expert editor who turns image prompts into character descriptions. You answer only with the description.',
    }
}

// props: the objects the characters carry (Character.prop) - they come into a clip with their owner's picture, so a place
// that shows one too has it twice in the picture (a knife on the counter and the same knife in the hand)
// standing: the props that stand in this place and are used there (propCarried false, e.g. a drum kit) - no character picture
// shows them, so the place has to, at one fixed spot
export function locationLookPrompt(lookBrief: string, storySummary: string, locationName: string, props: string[] = [], standing: string[] = []): AskOptions {
    return {
        input: `
Write a Krea 2 image prompt for an establishing shot of the given location.
The image must match the film look below - same medium, style, palette and lighting - but it is a clean reference plate, not a film frame: it must be sharp and clearly readable, so leave out anything that would degrade or obscure the detail.
Use the story summary as a guide to how the location fits into the story.

Rules:
- Natural language, one paragraph, 50-100 words.
- Start with the medium and style from the film look (e.g. "35mm film photograph of...", "2D anime background painting of...").
- The location is empty: no people, creatures or characters.
${props.length ? `- These objects belong to the characters and come into the picture with them - the place shows none of them, not even lying around, hanging or leaning somewhere: ${props.map(p => JSON.stringify(p)).join(', ')}.\n` : ''}${standing.length ? `- These objects stand in the place, ready to be used - each one exactly once, complete, at one fixed spot where it is clearly seen (a musical instrument with all the parts a player uses, at playing height - a drum kit with its drums, heads and cymbals on stands and a stool behind it): ${standing.map(p => JSON.stringify(p)).join(', ')}.\n` : ''}- Wide establishing shot; state the camera position and framing (e.g. "low-angle wide shot from the cave entrance").
- Describe only visible details: layout, architecture, terrain, materials, props, time of day, weather, light sources, atmosphere like fog, dust or smoke.
- Describe the place as it looks in this one frame, a state and not a process: no "slowly fading", "visibly shrinking", "walls closing in" or other change over time.
- Keep the medium/style name itself (e.g. "35mm film photograph"), but never call for film grain, noise, motion blur, chromatic aberration, VHS/scan artifacts or similar degrading texture, even if the film look mentions them - sharp focus and crisp detail throughout.
- No mood labels without visible evidence, no text or lettering in the image.
- Answer only with the prompt.

Film look: ${lookBrief}
Story summary: ${storySummary}
Location:
${JSON.stringify(locationName)}`,
        instructions: 'You are an expert production designer who writes prompts for the Krea 2 image model. You answer only with the prompt.',
    }
}

export function locationDescriptionPrompt(imagePrompt: string): AskOptions {
    return {
        input: `
Rewrite the image prompt below into a short description of the place itself.
The description defines the location in a video prompt, where characters act in it and the camera moves freely - so it must only say what the place looks like, nothing about the picture.

Keep: layout, architecture, terrain, materials, props, time of day, weather, light sources and atmosphere like fog, dust or smoke.
Leave out: the medium and style (e.g. "35mm film photograph of"), the camera position and framing (e.g. "low-angle wide shot from the entrance"), that the place is empty or has no people, film grain and anything else about the camera or the image.

Rules:
- One or two sentences, 30-60 words, starting with the place (e.g. "a vaulted stone forge with ...").
- Only details that are in the image prompt - add nothing, change nothing.
- Answer only with the description.

Image prompt: ${imagePrompt}`,
        instructions: 'You are an expert editor who turns image prompts into location descriptions. You answer only with the description.',
    }
}

// The phrase the clip prompt repeats behind the people of every shot (lib/compose.ts) - chosen by the LLM, so no code has to
// cut a description into pieces. Fixed features only: whatever can be picked up or moved may be gone or in a hand in a shot.
export function locationAnchorPrompt(description: string): AskOptions {
    return {
        maxTokens: 2048,
        // picks a phrase out of the description - with thinking, all three places of tides-of-eternal-flame were cut off at
        // 2048 tokens first; without it the same phrases in under a second
        reasoning: 'none',
        input: `
Below is the description of a place from a video prompt. Name two or three of its fixed features that stay visible behind the people in any shot of this place: large parts of the place that never move - walls, openings, built-in furniture, terrain, a light source. Never an object somebody could pick up or carry, never a person or a creature.

Rules:
- One noun phrase, 6-15 words, lowercase, without a full stop, e.g. "the long stone counter and the hallway to the right".
- Only features the description names - add nothing.
- Answer only with the phrase.

Place: ${description}`,
        instructions: 'You are an expert editor who picks the fixed background features of a place for a video prompt. You answer only with the phrase.',
    }
}

// The fixed layout of a place, written once from its look and used by every beat there (the shot planner stages people in
// it instead of inventing a room per beat), and what each of the five views of its reference sheet shows of it.
export function locationLayoutPrompt(name: string, look: string, description: string): AskOptions {
    return {
        maxTokens: 4096,
        input: `
A place of a music video is shown to the video model by a reference picture and by a sheet of five views of it:
${LOCATION_VIEWS.map((v, n) => `${n}: ${v}`).join('\n')}
Write the fixed layout of the place, so that every scene there is staged in the same room and every view shows the same place.

Answer only with JSON: {"layout": "...", "views": ["...", "...", "...", "...", "..."]}
- "layout": 3-5 sentences, the floor plan as seen from the camera of view 0: what is at the back, on the left, on the right and behind the camera, where the entrances are, where the light comes from, and how big the place is. Only what the picture shows, and where it does not show a side, what fits it plainly - nothing that moves, no people.
- "views": five entries, one per view above, in order: one sentence each with what that view shows of the layout - which features are in it, on which side of its frame.

Place: ${name}
Image prompt of the reference picture: ${look}
Description: ${description}`,
        instructions: 'You are a production designer who writes the fixed floor plan of a film set. Answer only with JSON.',
        schema: {
            type: 'object', additionalProperties: false, required: ['layout', 'views'],
            properties: {layout: {type: 'string'}, views: {type: 'array', minItems: LOCATION_VIEWS.length, maxItems: LOCATION_VIEWS.length, items: {type: 'string'}}},
        },
    }
}
