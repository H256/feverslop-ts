import {existsSync, readFileSync} from "node:fs";

// What a generated file was made from: its sidecar (<file>.json) carries a fingerprint of the request. Compared with the
// fingerprint of the request as it is now, a file is
//   pinned  - the user's own (sidecar says source "user"), or made before fingerprints existed: never touched, never reported
//   current - made from the same request
//   stale   - made from another request: reported with a list, put away and rendered again only when asked for
// Nothing here deletes or blocks: a stale file is still a usable file, it is only no longer silently taken for the plan.

export type Freshness = 'pinned' | 'current' | 'stale'

export const fingerprint = (...parts: unknown[]) => Bun.hash(JSON.stringify(parts)).toString(16)

/** The fingerprint of a file's content - 'missing' for a file that is not there yet. */
export const fileFingerprint = (path: string) => existsSync(path) ? Bun.hash(readFileSync(path)).toString(16) : 'missing'

function readSidecar(file: string): Record<string, unknown> | undefined {
    const sidecar = `${file}.json`
    if (!existsSync(sidecar)) return undefined
    try {
        const parsed = JSON.parse(readFileSync(sidecar, 'utf8'))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

/** The fingerprint a rendered file's sidecar records, if it has one. */
export const recordedFingerprint = (file: string) => {
    const value = readSidecar(file)?.fingerprint
    return typeof value === 'string' ? value : undefined
}

export function freshness(file: string, current: string): Freshness {
    const sidecar = readSidecar(file)
    if (!sidecar || sidecar.source === 'user' || sidecar.pinned === true) return 'pinned'
    const recorded = sidecar.fingerprint
    if (typeof recorded !== 'string') return 'pinned'
    return recorded === current ? 'current' : 'stale'
}

/** Is it a file the user put in place (its sidecar says so)? */
export const isUserFile = (file: string) => {
    const sidecar = readSidecar(file)
    return sidecar?.source === 'user' || sidecar?.pinned === true
}

/** The sidecar of a file the user put in place (tools/replace-character): it is kept as it is, whatever the prompts say later. */
export const pinnedSidecar = (note: string) => ({source: 'user', pinned: true, note})
