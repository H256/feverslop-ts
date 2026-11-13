// A prop of the library for a character's prop (#944): `bun run import-asset <project-id> prop <library-id> --for=<character>`, and the
// workspace's Casting page. The character's prop becomes the library's - its name, description and picture - in the project's props
// (config.propPictures); the plan keeps its shots, the clips that show the character are made with the new prop from the next run on.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {assetPaths, copyAsset} from './asset-import.ts'
import {libraryLayout, type LibraryAsset} from './library.ts'
import {clipRequestsDir} from './previous-output.ts'
import type {Project} from './project.ts'
import {castProps, type Prop} from './props.ts'

/** What taking a library prop for a character does, before anything is changed. */
export type PropImport = {
    characterId: string
    characterName: string
    old?: Prop // the character's prop until now
    prop: Prop // the one it gets
    clips: string[] // the clips of the plan that show the character: their requests change, a rendered one turns stale
    rendered: string[] // of those, the ones that are rendered
}

/** Why a library prop cannot be taken for this character - undefined: it can. */
export function propImportProblem(data: Project, propPictures: boolean, characterId: string, projectId: string): string | undefined {
    const characters = data.cast?.characters ?? []
    const character = characters.find(c => c.id === characterId)
    if (!data.cast) return `No cast in projects/${projectId}/project.json yet - plan the project first: bun index.ts ${projectId}`
    if (!character) return `"${characterId}" is no character of ${projectId}: ${characters.map(c => c.id).join(', ')}`
    if (!character.prop)
        return `${character.name} has no prop - a prop of the library replaces one the cast gave: ${
            characters
                .filter(c => c.prop)
                .map(c => c.id)
                .join(', ') || 'nobody has one'
        }`
    if (!propPictures) return `${projectId} has no prop pictures - turn them on first: "propPictures": true in its config.json (bun run config ${projectId})`
}

/** What taking `asset` for the prop of `characterId` would do. The prop keeps the library's id, unless another character's prop has it. */
export function planPropImport(dir: string, data: Project, characterId: string, asset: LibraryAsset): PropImport {
    const character = data.cast!.characters.find(c => c.id === characterId)!
    const props = data.props ?? castProps(data.cast!.characters)
    const taken = new Set(Object.entries(props).flatMap(([owner, p]) => (owner === characterId ? [] : [p.id])))
    let id = asset.id
    for (let n = 2; taken.has(id); n++) id = `${asset.id}-${n}`
    const clips = clipsShowing(dir, characterId)
    return {
        characterId,
        characterName: character.name,
        ...(props[characterId] ? {old: props[characterId]} : {}),
        prop: {id, name: asset.name, description: asset.description},
        clips,
        rendered: clips.filter(clip => existsSync(join(dir, 'videos', `${clip}.mp4`))),
    }
}

/**
 * Takes the library prop: its picture is copied to assets/props/<id>.png, pinned (never rendered again; a picture of that id there
 * before is put away in old/attempts/), and the character's prop in `data.props` is the new one - the caller saves project.json.
 */
export function applyPropImport(dir: string, data: Project, plan: PropImport, library: string, libraryId: string) {
    const done = copyAsset(
        {dir: library, layout: libraryLayout('prop', libraryId), label: 'library'},
        {dir, layout: assetPaths('prop', plan.prop.id), archiveName: plan.prop.id},
    )
    data.props = {...(data.props ?? castProps(data.cast!.characters)), [plan.characterId]: plan.prop}
    return done
}

// the clips of the last plan run with the character's picture in them
function clipsShowing(dir: string, characterId: string): string[] {
    const clipsDir = clipRequestsDir(dir)
    if (!existsSync(clipsDir)) return []
    return readdirSync(clipsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .filter(f => {
            const clip = JSON.parse(readFileSync(join(clipsDir, f), 'utf8')) as {assets?: {pictures?: {kind?: string; id: string}[]}}
            return clip.assets?.pictures?.some(p => p.kind === 'character' && (p.id === characterId || p.id.startsWith(`${characterId}-v`)))
        })
        .map(f => f.slice(0, -'.json'.length))
}
