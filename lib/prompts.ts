import type {AskOptions} from "./llm.ts";

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

export function storyPrompt(lyrics: string, storyIdea: string): AskOptions {
    return {
        input: `
    Take the following Lyrics and Story Idea and craft a story from it.
    Lyrics: ${lyrics || '(none)'}
    Story-Idea: ${storyIdea || '(none)'}
`,
        instructions: `You are a movie story writer. You will be given lyrics and a story idea, either of which may be missing (marked as "(none)").
- If both are given, craft a story that considers both the lyrics and the story idea.
- If only one is given, craft the story based on the one that is present.
- If both are missing, do not write a story. Answer only with: NO STORY`,
    }
}

export function summaryPrompt(storyBase: string): AskOptions {
    return {
        maxTokens: 4096,
        input: `
Summarize the story and try to keep locations and characters intact.
---
story:
${storyBase}
`,
        instructions: 'You are an expert for story summarization. You receive a story and summarize it. Answer only with the summary.',
    }
}

export function castPrompt(storyBase: string): AskOptions {
    return {
        input: `Here is a story concept.
You need to extract all characters and their role in the story.
Furthermore you need to extract all locations from the story.
Answer only with JSON in this format:
{
    "characters": [{"name": "", "role": "", "prop": "", "propStem": ""}],
    "locations": [{"name": ""}]
}
The rules for characters are: A character is a person or creature in the story. They have a name and a role. The role is a short description of what the character does in the story.
Additionally, for every character:
- "prop": if the character visibly carries or uses one distinctive physical object throughout the story (a weapon, tool, musical instrument, etc.), name it briefly (e.g. "electric guitar", "iron sword", "drum kit"). Every visible member of a band must get their actual instrument here, including drummers and other backing musicians, not just the lead. Leave it an empty string if the character carries nothing distinctive.
- "propStem": only when "prop" is a musical instrument whose sound is actually part of the song (i.e. this is a band performing the song on screen) - which layer of the song's audio it belongs to: "drums" for a drum kit, "bass" for a bass guitar, "guitar" for any electric/acoustic guitar, "piano" for piano/keys, "other" for anything else melodic (synth, strings, etc. - only when none of the above fit). Leave it an empty string for a prop that is not a musical instrument, for an instrument that is not actually heard in the song, or whenever the story is not a band performing live.
The rules for locations are: List them in order of appearance in the story. A location is a place that can be filmed as one set.
---
story:
${storyBase}
`,
        instructions: 'You are an expert data extractor for Stories. You receive a Story and extract locations and characters from it. Answer only with the extracted data.',
    }
}

const lookRules = `Describe in 120-180 words, as plain prose:
- Format and style: name the medium first and be specific. Pick whichever actually fits the story and the director's brief best, don't default to live-action photography (e.g. "2D anime in the style of 90s cel animation", "live action shot on 35mm film", "hand-painted dark fantasy oil painting", "stop-motion with visible puppet seams", "grainy VHS found-footage horror", "woodcut/engraving line art").
- World: architecture, landscapes, materials and textures of the world.
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
Pick ONE format and style that fits the story best (e.g. photorealistic live action, painterly art film, 2D anime, comic/graphic novel, stop-motion, 3D animation) and commit to it - never mix styles.

${lookRules}
---
story:
${storySummary}`,
        instructions: `You are a film director and cinematographer who designs the visual language of films for AI video models like MiniMax H3.`,
    }
}

// otherLooks: the already-designed reference prompts of the rest of the cast (built earlier in the same loop) -
// without them, two characters with a similar role/archetype (e.g. "loyal companion") reliably converge on
// near-identical builds, palettes and wardrobes, which a reference-to-video model then can't tell apart on
// screen and swaps mid-shot. Forcing a comparison against what already exists is what actually spreads them out;
// asking each character to be "distinctive" in isolation does not, since every character looks distinctive alone.
export function characterLookPrompt(lookBrief: string, char: { name: string, role: string }, otherLooks: { name: string, look: string }[] = []): AskOptions {
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
- Keep the medium/style name itself (e.g. "35mm film photograph"), but never call for film grain, noise, motion blur, chromatic aberration, VHS/scan artifacts or similar degrading texture, even if the film look mentions them - sharp focus and crisp detail throughout.
- No mood labels without visible evidence, no text or lettering in the image.
- Answer only with the prompt.

Film look: ${lookBrief}
Character:
${JSON.stringify({name: char.name, role: char.role})}${otherLooks.length ? `
Already-designed cast (for silhouette contrast only - do not copy or borrow their specific colors/props):
${otherLooks.map(o => `- ${o.name}: ${o.look}`).join('\n')}` : ''}`,
        instructions: 'You are an expert character designer who writes prompts for the Krea 2 image model. You answer only with the prompt.',
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
- Only details that are in the image prompt - add nothing, change nothing.
- Answer only with the description.

Image prompt: ${imagePrompt}`,
        instructions: 'You are an expert editor who turns image prompts into character descriptions. You answer only with the description.',
    }
}

export function locationLookPrompt(lookBrief: string, storySummary: string, locationName: string): AskOptions {
    return {
        input: `
Write a Krea 2 image prompt for an establishing shot of the given location.
The image must match the film look below - same medium, style, palette and lighting - but it is a clean reference plate, not a film frame: it must be sharp and clearly readable, so leave out anything that would degrade or obscure the detail.
Use the story summary as a guide to how the location fits into the story.

Rules:
- Natural language, one paragraph, 50-100 words.
- Start with the medium and style from the film look (e.g. "35mm film photograph of...", "2D anime background painting of...").
- The location is empty: no people, creatures or characters.
- Wide establishing shot; state the camera position and framing (e.g. "low-angle wide shot from the cave entrance").
- Describe only visible details: layout, architecture, terrain, materials, props, time of day, weather, light sources, atmosphere like fog, dust or smoke.
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
