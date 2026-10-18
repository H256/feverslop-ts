// A character's or a place's finished pictures, carried over from another project instead of rendered again
// (tools/import-asset.ts): the picture itself (assets/<kind>s/<id>.png) and its reference sheet
// (assets/sequence/<kind>s/<id>/ - anchor, sequence video, frames), renamed to the id it has in the target project.

import {cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {archiveFiles, versionStamp} from "./archive.ts";
import {pinnedSidecar} from "./provenance.ts";

export type AssetKind = 'character' | 'location'

/** The files of an asset, relative to its project: the picture, its sidecar and the sheet folder. */
export const assetPaths = (kind: AssetKind, id: string) => ({
    picture: `assets/${kind}s/${id}.png`,
    sheet: `assets/sequence/${kind}s/${id}`,
})

/** The ids of a kind that have a picture or a sheet in a project folder. */
export function assetIds(projectDir: string, kind: AssetKind): string[] {
    const ids = new Set<string>()
    const pictures = join(projectDir, 'assets', `${kind}s`)
    if (existsSync(pictures)) for (const f of readdirSync(pictures)) if (f.endsWith('.png') && !f.includes('.partial')) ids.add(f.slice(0, -4))
    const sheets = join(projectDir, 'assets', 'sequence', `${kind}s`)
    if (existsSync(sheets)) for (const d of readdirSync(sheets)) if (statSync(join(sheets, d)).isDirectory()) ids.add(d)
    return [...ids].sort()
}

// left behind by a render that did not finish, or the record of one - not part of a finished asset
const unfinished = (file: string) => /\.(partial|pending)\b|\.vision\.png$/.test(file)

/**
 * What one import copies: every file of the source asset (relative to the source project) to where it goes in the
 * target (relative to the target project). The sidecars (.json next to a file) are not copied - the target gets its own.
 */
export function importPlan(sourceDir: string, sourceId: string, targetId: string, kind: AssetKind): { from: string, to: string, sidecar: boolean }[] {
    const source = assetPaths(kind, sourceId)
    const target = assetPaths(kind, targetId)
    const files: string[] = []
    if (existsSync(join(sourceDir, source.picture))) files.push(source.picture)
    const walk = (rel: string) => {
        for (const entry of readdirSync(join(sourceDir, rel))) {
            const path = `${rel}/${entry}`
            if (statSync(join(sourceDir, path)).isDirectory()) walk(path)
            else files.push(path)
        }
    }
    if (existsSync(join(sourceDir, source.sheet))) walk(source.sheet)
    return files
        .filter(f => !f.endsWith('.json') && !unfinished(f))
        .map(from => ({
            from,
            to: from === source.picture ? target.picture : `${target.sheet}${from.slice(source.sheet.length)}`,
            sidecar: existsSync(join(sourceDir, `${from}.json`)),
        }))
}

/**
 * Copies the asset: the target's own files of it are put away in old/attempts first (nothing is deleted), every copied
 * file that had a sidecar gets a pinned one - the user's choice, never reported stale and never rendered again
 * (lib/provenance.ts). Returns where the old files went, if there were any.
 */
export function importAsset(sourceDir: string, sourceLabel: string, sourceId: string, targetDir: string, targetId: string, kind: AssetKind): { copied: number, putAway?: string } {
    const plan = importPlan(sourceDir, sourceId, targetId, kind)
    if (!plan.length) throw new Error(`${sourceLabel} has no ${kind} "${sourceId}" in assets/`)
    const target = assetPaths(kind, targetId)
    const old = [target.picture, `${target.picture}.json`, target.sheet].filter(f => existsSync(join(targetDir, f)))
    const putAway = old.length ? relative(targetDir, archiveFiles(targetDir, `${targetId}-${versionStamp()}`, old)) : undefined
    for (const {from, to, sidecar} of plan) {
        mkdirSync(dirname(join(targetDir, to)), {recursive: true})
        cpSync(join(sourceDir, from), join(targetDir, to))
        if (sidecar) writeFileSync(join(targetDir, `${to}.json`), JSON.stringify(pinnedSidecar(`imported from ${sourceLabel}/${from}`), null, 2))
    }
    return {copied: plan.length, ...(putAway ? {putAway} : {})}
}
