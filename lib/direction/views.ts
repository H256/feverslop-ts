/** Retain view choices only for the effective plan they were chosen from, including restored baselines. */
export function directionViewCache(base: Record<string, unknown> = {}, directed: Record<string, unknown> = {}, views: Record<string, number[]> = {}, previous: Record<string, string> = {}) {
    const keys = Object.fromEntries(Object.entries(directed).map(([id, plan]) => [id, Bun.hash(JSON.stringify(plan)).toString(16)]));
    const kept = {...views};
    let invalidated = false;
    for (const [id, key] of Object.entries(keys)) {
        if (previous[id] ? previous[id] !== key : JSON.stringify(directed[id]) !== JSON.stringify(base[id])) {
            delete kept[id];
            invalidated = true;
        }
    }
    return {keys, kept, invalidated};
}
