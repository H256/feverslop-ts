import type {AskOptions} from "./llm.ts";

// The LLM prompt templates for the early story/look pipeline steps (index.ts, steps 1-6b) - kept separate from
// the orchestration so the prompt copy can be read and edited without the surrounding pipeline wiring.

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
    "characters": [{"name": "", "role": ""}],
    "locations": [{"name": ""}]
}
The rules for characters are: A character is a person or creature in the story. They have a name and a role. The role is a short description of what the character does in the story.
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

export function characterLookPrompt(lookBrief: string, char: { name: string, role: string }): AskOptions {
    return {
        input: `
Write a Krea 2 image prompt for a character reference sheet of the given character.
The image must match the film look below exactly - same medium, style, palette and lighting.
Consider the character's role in the story when designing the look.

Rules:
- Natural language, one paragraph, 50-100 words.
- Start with the medium and style from the film look (e.g. "35mm film photograph of...", "2D anime illustration of...").
- Describe exactly ONE character, even if the name is plural.
- Full body, standing, facing the camera, in front of a plain grey neutral background, so the image can be reused as a reference.
- Describe only visible details: face, age, build, skin, hair, clothing, materials, colors, accessories, and how the light falls on them.
- No mood labels without visible evidence, no text or lettering in the image.
- Answer only with the prompt.

Film look: ${lookBrief}
Character:
${JSON.stringify({name: char.name, role: char.role})}`,
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
The image must match the film look below exactly - same medium, style, palette and lighting.
Use the story summary as a guide to how the location fits into the story.

Rules:
- Natural language, one paragraph, 50-100 words.
- Start with the medium and style from the film look (e.g. "35mm film photograph of...", "2D anime background painting of...").
- The location is empty: no people, creatures or characters.
- Wide establishing shot; state the camera position and framing (e.g. "low-angle wide shot from the cave entrance").
- Describe only visible details: layout, architecture, terrain, materials, props, time of day, weather, light sources, atmosphere like fog, dust or smoke.
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
