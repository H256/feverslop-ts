import {fingerprint} from "./provenance.ts";
import {log, styles} from "./log.ts";

// A step that asks the model once per element (a character, a place, a scene) keeps each answer as soon as it is there:
// the whole step is only saved when it returns, so a failure on the last scene used to lose every call before it. The
// answers wait in `partials` of the project file, each with a fingerprint of what it was asked - a rerun asks only for
// what is missing or was asked differently. The step's own result replaces them when it is done.

export type Partials = Record<string, Record<string, { fingerprint: string, value: unknown }>>

export async function keepEach<T>(
    data: { partials?: Partials },
    save: () => Promise<void>,
    step: string, key: string, input: unknown, run: () => Promise<T>,
): Promise<T> {
    const wanted = fingerprint(input)
    const kept = data.partials?.[step]?.[key]
    if (kept && kept.fingerprint === wanted) {
        log.step('Kept', styles.muted(`${step} · ${key} - answered in an earlier run`))
        return kept.value as T
    }
    const value = await run()
    const partials = data.partials ??= {}
    ;(partials[step] ??= {})[key] = {fingerprint: wanted, value}
    await save()
    return value
}

/**
 * As keepEach, for an element that can end without an answer (undefined): only an answer is kept, so the next run asks
 * again for an element that had none - the shot planning of a beat whose answers stayed unusable (index.ts, step 11b).
 */
export async function keepFound<T>(
    data: { partials?: Partials },
    save: () => Promise<void>,
    step: string, key: string, input: unknown, run: () => Promise<T | undefined>,
): Promise<T | undefined> {
    const wanted = fingerprint(input)
    const kept = data.partials?.[step]?.[key]
    if (kept && kept.fingerprint === wanted) {
        log.step('Kept', styles.muted(`${step} · ${key} - planned in an earlier run`))
        return kept.value as T
    }
    const value = await run()
    if (value === undefined) return undefined
    const partials = data.partials ??= {}
    ;(partials[step] ??= {})[key] = {fingerprint: wanted, value}
    await save()
    return value
}

/** The kept answers of a step are dropped - when the step is done, or redone. */
export function dropPartials(data: { partials?: Partials }, step: string) {
    if (!data.partials?.[step]) return
    delete data.partials[step]
    if (!Object.keys(data.partials).length) delete data.partials
}
