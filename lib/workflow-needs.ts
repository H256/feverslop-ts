import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {workflowDir} from './config.ts'

// What a workflow needs on a ComfyUI server (#828), read from its source: the nodes it builds (`wf.Node(`) and the model files it
// names ('….safetensors'), with the builders it imports from comfy/. The server is to have both under the same names - the convention
// is the same relative path on every server. A model only named for one of a workflow's choices is listed too: the check says it, a run
// may not need it.

const MODEL = /'([^'\s]+\.(?:safetensors|gguf|pth|ckpt|pt|bin))'/g
const NODE = /\bwf\.([A-Za-z_][\w]*)\(/g
const IMPORT = /from '(\.{1,2}\/[^']+\.ts)'/g

/** The nodes and model files a workflow of comfy/workflows/ names, its own builders included. */
export function workflowNeeds(name: string): {nodes: string[]; models: string[]} {
    const nodes = new Set<string>(),
        models = new Set<string>(),
        seen = new Set<string>()
    const read = (file: string) => {
        if (seen.has(file) || !existsSync(file) || file.endsWith(`${join('comfy', 'helpers.ts')}`)) return
        seen.add(file)
        const source = readFileSync(file, 'utf8')
        for (const [, node] of source.matchAll(NODE)) nodes.add(node!)
        for (const [, model] of source.matchAll(MODEL)) models.add(model!)
        for (const [, path] of source.matchAll(IMPORT)) read(resolve(dirname(file), path!))
    }
    read(join(workflowDir, `${name}.ts`))
    return {nodes: [...nodes].sort(), models: [...models].sort()}
}

/** The nodes a server has, and every file name its loaders offer: from its /object_info. */
export function serverOffers(objectInfo: Record<string, unknown>): {nodes: Set<string>; files: Set<string>} {
    const files = new Set<string>()
    for (const node of Object.values(objectInfo) as {input?: Record<string, Record<string, unknown>>}[])
        for (const group of Object.values(node.input ?? {}))
            for (const spec of Object.values(group ?? {}))
                if (Array.isArray(spec) && Array.isArray(spec[0])) for (const option of spec[0] as unknown[]) if (typeof option === 'string') files.add(option)
    return {nodes: new Set(Object.keys(objectInfo)), files}
}

/** What a workflow needs that the server does not offer. A file counts by its name in any folder of the server's lists. */
export function missingOn(needs: {nodes: string[]; models: string[]}, offers: {nodes: Set<string>; files: Set<string>}) {
    const names = new Set([...offers.files].map(file => file.split(/[\\/]/).at(-1)!))
    return {
        nodes: needs.nodes.filter(node => !offers.nodes.has(node)),
        models: needs.models.filter(model => !offers.files.has(model) && !names.has(model.split(/[\\/]/).at(-1)!)),
    }
}
