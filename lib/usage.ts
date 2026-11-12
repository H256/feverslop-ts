// What a usage error says (#817): the cause in one line, a suggestion where there is one - never the whole usage, which is in --help.
// No imports of the pipeline: a mistyped option is answered at once.

/** The edits that turn one word into another - small for a slip of the fingers. */
export function editDistance(a: string, b: string): number {
    let row = Array.from({length: b.length + 1}, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        const next = [i]
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
        row = next
    }
    return row[b.length]!
}

/** The one of `known` a mistyped word most likely means - undefined when none is near (at most a third of it wrong). */
export function closest(word: string, known: Iterable<string>): string | undefined {
    let best: string | undefined
    let bestDistance = Infinity
    for (const candidate of new Set(known)) {
        const distance = editDistance(word, candidate)
        if (distance < bestDistance) [best, bestDistance] = [candidate, distance]
    }
    return bestDistance <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined
}

/** The options a usage text names: --render, --only … */
export const optionsIn = (usage: string) => [...new Set(usage.match(/--[a-z][a-z0-9-]*/g) ?? [])]

/**
 * The message of an unknown option in our words, with the option it most likely means. node:util parseArgs says "Unknown option
 * '--rendr'. To specify a positional argument starting with a '-', place it at the end of the command after '--' …" - the second
 * half helps nobody here. Every other message stays as it is.
 */
export function usageMessage(message: string, usage: string): string {
    const unknown = /^Unknown option '(-{1,2}[^']+)'/.exec(message)?.[1]
    if (!unknown) return message
    const name = unknown.split('=')[0]!
    const meant = closest(name, optionsIn(usage))
    return `Unknown option ${name}${meant ? ` - did you mean ${meant}?` : ''}`
}

/** As many names as a line takes, the nearest to what was typed first. */
function some(ids: string[], typed: string | undefined, most = 8): string {
    // what was typed is often the beginning of the id: those first, then by how few edits are between them
    const rank = (id: string) => (typed && id.startsWith(typed) ? -1 : editDistance(typed ?? '', id))
    const sorted = typed ? [...ids].sort((a, b) => rank(a) - rank(b)) : ids
    return sorted.slice(0, most).join(', ') + (sorted.length > most ? ` and ${sorted.length - most} more` : '')
}

/**
 * Why a command has no project to work on, the same in every command: which one was asked for, the ones there are (the nearest
 * names first), or how the first one is made.
 */
export function noProject(kind: 'project' | 'film', id: string | undefined, existing: string[]): string {
    const what = id ? `No ${kind} "${id}"` : `No ${kind} id given`
    const create = kind === 'film' ? 'bun run film:init' : 'bun run init'
    // nothing here yet: the machine first, then the first one (#828)
    return existing.length
        ? `${what} - the ${kind}s here are: ${some(existing, id)}`
        : `${what}, and there is no ${kind} yet - see what this machine has first: bun run doctor, then create one with: ${create}`
}
