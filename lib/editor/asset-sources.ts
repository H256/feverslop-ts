import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {type AssetKind, assetIds} from '../asset-import.ts'
import {listProjects, projectDir} from '../project-setup.ts'
import type {Project} from '../project.ts'
import type {AssetSource} from '../../shared/workspace.ts'

// The other music videos with a finished character or place of this kind (#835): what `bun run import-asset <id> <asset>
// --from=<project>:<asset>` can take over - its pictures and its whole reference sheet. It only reads.

export function assetSources(id: string, kind: AssetKind): AssetSource[] {
    return listProjects()
        .filter(other => other !== id)
        .flatMap(other => {
            const dir = projectDir(other)
            const ids = assetIds(dir, kind)
            if (!ids.length) return []
            let data: Partial<Project> = {}
            try {
                if (existsSync(join(dir, 'project.json'))) data = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Partial<Project>
            } catch {
                // a project that cannot be read still has its pictures
            }
            const named = kind === 'character' ? data.cast?.characters : data.cast?.locations
            const described = kind === 'character' ? data.characterDescriptions : data.locationDescriptions
            return [
                {
                    project: other,
                    assets: ids.map(asset => ({
                        id: asset,
                        name: named?.find(entry => entry.id === asset)?.name ?? asset,
                        described: !!described?.[asset],
                    })),
                },
            ]
        })
}
