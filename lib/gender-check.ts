import {askJson} from "./llm.ts";

/**
 * After a character's picture was swapped: does the picture's description give them another gender than the story text does? The story
 * writes pronouns into every beat ("she", "her body"), and a swapped picture does not change them - the video model gets the picture of a
 * man and a text about a woman. Read by the language model, nothing guessed from words. Undefined = they agree, or it is unclear.
 */
export async function genderNote(name: string, storyText: string, pictureDescription: string): Promise<string | undefined> {
    const answer = await askJson<{ story?: string, picture?: string }>({
        maxTokens: 1024,
        reasoning: 'low',
        input: `Character: ${name}\n\nText about the character (the story):\n${storyText}\n\nDescription of the character's new picture:\n${pictureDescription}`,
        instructions: 'You compare two descriptions of one character. Answer only with JSON {"story": "female" | "male" | "unknown", "picture": "female" | "male" | "unknown"}: the gender the story text gives the character (pronouns, words like woman or man), and the gender the description of the picture gives. "unknown" where it does not say.',
    })
    const known = (value?: string) => value === 'female' || value === 'male'
    if (!known(answer.story) || !known(answer.picture) || answer.story === answer.picture) return undefined
    return `The story text writes ${name} as ${answer.story === 'female' ? 'a woman' : 'a man'}, the new picture shows ${answer.picture === 'female' ? 'a woman' : 'a man'} - the pronouns in the story stay as they are.`
}
