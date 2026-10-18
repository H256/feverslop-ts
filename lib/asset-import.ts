// A character's or a place's finished pictures, carried over instead of rendered again (tools/import-asset.ts,
// tools/export-asset.ts): the picture itself and its reference sheet (anchor, sequence video, frames), between two
// places that lay them out differently - a project (assets/<kind>s/<id>.png, assets/sequence/<kind>s/<id>/) and the
// library (lib/library.ts).

import {cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {archiveFiles, versionStamp} from "./archive.ts";
import {pinnedSidecar} from "./provenance.ts";

export type AssetKind = 'character' | 'location'

/** Where an asset's files are, relative to the folder they belong to: the picture and the sheet folder. */
export type AssetLayout = { picture: string, sheet: string }

/** The files of an asset in a project. */
export const assetPaths = (kind: AssetKind, id: string): AssetLayout => ({
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
 * What one copy does: every file of the asset (relative to `sourceDir`) to where it goes (relative to the target folder).
 * Sidecars (.json next to a file) are not copied - the target gets its own. `pin`: the file is one a render checks (the
 * picture, the anchor, the sequence video - not the frames), so its copy gets a pinned sidecar.
 */
export function copyPlan(sourceDir: string, source: AssetLayout, target: AssetLayout): { from: string, to: string, pin: boolean }[] {
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
        .map(from => {
            const to = from === source.picture ? target.picture : `${target.sheet}${from.slice(source.sheet.length)}`
            return {from, to, pin: !to.slice(target.sheet.length).includes('/frames/')}
        })
}

/** The project-to-project plan of import-asset - see copyPlan. */
export const importPlan = (sourceDir: string, sourceId: string, targetId: string, kind: AssetKind) =>
    copyPlan(sourceDir, assetPaths(kind, sourceId), assetPaths(kind, targetId))

/**
 * Copies an asset: the target's own files of it are put away in `<archiveDir>/old/attempts` first (nothing is deleted),
 * every copied file a render checks gets a pinned sidecar - the user's choice, never reported stale and never rendered
 * again (lib/provenance.ts). Returns where the old files went, if there were any.
 */
export function copyAsset(
    source: { dir: string, layout: AssetLayout, label: string },
    target: { dir: string, layout: AssetLayout, archiveName: string },
): { copied: number, putAway?: string } {
    const plan = copyPlan(source.dir, source.layout, target.layout)
    if (!plan.length) throw new Error(`${source.label} has no finished pictures`)
    const old = [target.layout.picture, `${target.layout.picture}.json`, target.layout.sheet].filter(f => existsSync(join(target.dir, f)))
    const putAway = old.length ? relative(target.dir, archiveFiles(target.dir, `${target.archiveName}-${versionStamp()}`, old)) : undefined
    for (const {from, to, pin} of plan) {
        mkdirSync(dirname(join(target.dir, to)), {recursive: true})
        cpSync(join(source.dir, from), join(target.dir, to))
        if (pin) writeFileSync(join(target.dir, `${to}.json`), JSON.stringify(pinnedSidecar(`copied from ${source.label}/${from}`), null, 2))
    }
    return {copied: plan.length, ...(putAway ? {putAway} : {})}
}

/** import-asset between two projects - see copyAsset. */
export function importAsset(sourceDir: string, sourceLabel: string, sourceId: string, targetDir: string, targetId: string, kind: AssetKind) {
    if (!copyPlan(sourceDir, assetPaths(kind, sourceId), assetPaths(kind, targetId)).length) throw new Error(`${sourceLabel} has no ${kind} "${sourceId}" in assets/`)
    return copyAsset({dir: sourceDir, layout: assetPaths(kind, sourceId), label: sourceLabel}, {dir: targetDir, layout: assetPaths(kind, targetId), archiveName: targetId})
}
