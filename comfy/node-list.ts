// The server's node list (/object_info), cleaned the same way for comfy/gen-types.ts and comfy/json-to-ts.ts,
// so output names in converted workflows always match the generated nodes.ts.

import {authHeaders, type ComfyServer, loadSettings} from "../lib/settings.ts";

export type ObjectInfo = Record<string, any>

/**
 * The server the node tools read from: --comfy=<url>, else the first ComfyUI server of the settings.
 * All servers need the same nodes and models, so one is enough.
 */
export async function nodeServer(flag?: string): Promise<ComfyServer> {
    const server = (await loadSettings({comfy: flag})).comfy[0]!
    console.log(`ComfyUI server: ${server.name} (${server.url})`)
    return server
}

export async function fetchNodeList(server: ComfyServer): Promise<ObjectInfo> {
    // the node list of a big install is several MB, so a generous limit - but not forever
    const timeoutMs = 60_000
    let response: Response
    try {
        response = await fetch(`${server.url}/object_info`, {headers: authHeaders(server), signal: AbortSignal.timeout(timeoutMs)})
    } catch (e) {
        const error = e as Error
        throw new Error(`ComfyUI ${server.name} (${server.url}) is unreachable - ${error.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : error.message}. Start it, or pick another server with --comfy=<url>`)
    }
    if (!response.ok) throw new Error(`${server.url}/object_info: ${response.status} ${response.statusText}`)
    return cleanNodeList(await response.json() as ObjectInfo).objectInfo
}

/**
 * - several outputs with the same name (e.g. two "FLOAT"s) are numbered: FLOAT, FLOAT_2 -
 *   otherwise only the last one is reachable in the generated code
 * - inputs declared both required and optional are kept as required
 */
export function cleanNodeList(objectInfo: ObjectInfo) {
    let fixed = 0
    for (const node of Object.values(objectInfo)) {
        if (Array.isArray(node.output_name)) {
            const seen = new Map<string, number>()
            node.output_name = node.output_name.map((name: string) => {
                const count = (seen.get(name) ?? 0) + 1
                seen.set(name, count)
                if (count > 1) fixed++
                return count > 1 ? `${name}_${count}` : name
            })
        }
        for (const name of Object.keys(node.input?.optional ?? {})) {
            if (node.input?.required?.[name]) {
                delete node.input.optional[name]
                fixed++
            }
        }
    }
    return {objectInfo, fixed}
}
