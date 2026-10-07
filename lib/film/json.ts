import {type AskOptions, askJson} from "../llm.ts";
import {log} from "../log.ts";

/**
 * askJson, asked again when the answer is not valid JSON (a trailing comma, a missing quote - long answers from a local
 * model now and then have one, and a run that stops for it throws away minutes of work). Everything else is thrown.
 */
export async function askFilmJson<T>(options: AskOptions, tries = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await askJson<T>(options)
        } catch (e) {
            if (!(e instanceof Error) || !e.message.startsWith('LLM did not answer with valid JSON') || attempt >= tries) throw e
            log.warn(`${e.message} - asking again (${attempt + 1}/${tries})`)
        }
    }
}
