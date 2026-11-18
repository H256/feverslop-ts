import {existsSync, readFileSync} from 'node:fs'

// What a generated file was made from: its sidecar (<file>.json) carries a fingerprint of the request. Compared with the
// fingerprint of the request as it is now, a file is
//   pinned  - the user's own (sidecar says source "user"), or made before fingerprints existed: never touched, never reported
//   current - made from the same request
//   stale   - made from another request: reported with a list, put away and rendered again only when asked for
// Nothing here deletes or blocks: a stale file is still a usable file, it is only no longer silently taken for the plan.

export type Freshness = 'pinned' | 'current' | 'stale'

export const fingerprint = (...parts: unknown[]) => Bun.hash(JSON.stringify(parts)).toString(16)

/** The fingerprint of a file's content - 'missing' for a file that is not there yet. Within eachFileOnce, each file is read once. */
export function fileFingerprint(path: string) {
    if (!existsSync(path)) return 'missing'
    const known = sweep?.get(path)
    if (known) return known
    const print = Bun.hash(readFileSync(path)).toString(16)
    sweep?.set(path, print)
    return print
}
// A pass over many clips names the same few pictures in every clip's request (#1159). Within one synchronous pass nothing is written,
// so each file is read once there. Not across passes: the time of a file is no proof - Windows moves it in steps of about 15 ms, and
// a picture written again at the same size would keep its old fingerprint.
let sweep: Map<string, string> | undefined

/** Runs `pass` - synchronous: an await inside ends the sharing - with each file fingerprinted once. */
export function eachFileOnce<T>(pass: () => T): T {
    if (sweep) return pass()
    sweep = new Map()
    try {
        return pass()
    } finally {
        sweep = undefined
    }
}

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

/** The prompt a rendered file's sidecar records, if it has one. */
export const recordedPrompt = (file: string) => {
    const value = readSidecar(file)?.prompt
    return typeof value === 'string' ? value : undefined
}

/** The prompt a picture was rendered from when the user edited it (lib/render.ts pinEditedPicture), if it was. */
export const recordedEditedPrompt = (file: string) => {
    const value = readSidecar(file)?.editedPrompt
    return typeof value === 'string' ? value : undefined
}

/** How many frames of the clip before a rendered clip started on (contextFrames), if its sidecar records it. */
export const recordedContextFrames = (file: string) => {
    const value = readSidecar(file)?.contextFrames
    return Number.isInteger(value) ? (value as number) : undefined
}

/** The fingerprint a rendered file's sidecar records, if it has one. */
export const recordedFingerprint = (file: string) => {
    const value = readSidecar(file)?.fingerprint
    return typeof value === 'string' ? value : undefined
}

export function freshness(file: string, current: string): Freshness {
    const sidecar = readSidecar(file)
    if (!sidecar && file.endsWith('.mp4') && existsSync(file)) return 'stale'
    if (!sidecar || sidecar.source === 'user' || sidecar.pinned === true) return 'pinned'
    const recorded = sidecar.fingerprint
    if (typeof recorded !== 'string') return 'pinned'
    return recorded === current ? 'current' : 'stale'
}

/** Video bytes alone do not establish that a generated take was committed successfully. */
export const incompleteClip = (file: string) => file.endsWith('.mp4') && existsSync(file) && !readSidecar(file)

/** Is it a file the user put in place (its sidecar says so)? */
export const isUserFile = (file: string) => {
    const sidecar = readSidecar(file)
    return sidecar?.source === 'user' || sidecar?.pinned === true
}

/** Is it a picture of the user's own (tools/replace-character, an upload) - not one rendered here from an edited prompt? */
export const isOwnFile = (file: string) => readSidecar(file)?.source === 'user'

/** The sidecar of a file the user put in place (tools/replace-character): it is kept as it is, whatever the prompts say later. */
export const pinnedSidecar = (note: string) => ({source: 'user', pinned: true, note})
