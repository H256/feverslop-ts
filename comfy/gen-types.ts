import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
// Generates comfy/nodes.ts - a typed WorkflowBuilder with one method per node installed on the ComfyUI server.
// Run again after installing custom nodes or models: bun run comfy:types [--comfy=http://host:8188]
// Reads the first ComfyUI server of the settings - all servers need the same nodes and models.
//
// Uses the SDK's `cfli codegen`, with two fixes so the result type-checks under this project's strict config:
// - some custom nodes have several outputs with the same name (e.g. two "FLOAT"s) - only the last one would be
//   reachable. cfli reads the node list from the server, so it gets it through a small local proxy that numbers
//   duplicates: FLOAT, FLOAT_2. Inputs declared both required and optional are kept as required.
// - the generated imports mix types and values, which verbatimModuleSyntax forbids.
import {join} from "node:path";
import {parseArgs} from "node:util";
import {authHeaders} from "../lib/settings.ts";
import {cleanNodeList, nodeServer} from "./node-list.ts";
cli('comfy:types')


const {values: args} = parseArgs({args: Bun.argv.slice(2), options: {comfy: {type: 'string'}}})
const server = await nodeServer(args.comfy)
const file = join(import.meta.dir, 'nodes.ts')

let fixed = 0
const proxy = Bun.serve({
    port: 0,
    async fetch(request) {
        const url = new URL(request.url)
        const headers = new Headers(request.headers)
        headers.delete('host')
        for (const [name, value] of Object.entries(authHeaders(server))) headers.set(name, value)
        const response = await fetch(`${server.url}${url.pathname}${url.search}`, {method: request.method, headers, body: request.body})
        if (url.pathname !== '/object_info') return response
        const cleaned = cleanNodeList(await response.json() as Record<string, any>)
        fixed = cleaned.fixed
        return Response.json(cleaned.objectInfo)
    },
})

try {
    const proc = Bun.spawn(['bunx', 'cfli', 'codegen', '-H', `http://localhost:${proxy.port}`, '-o', file], {stdout: 'inherit', stderr: 'inherit'})
    const code = await proc.exited
    if (code !== 0) process.exit(code)
} finally {
    proxy.stop(true)
}

const code = await Bun.file(file).text()
await Bun.write(file, code.replace(
    /^import \{ WorkflowBuilder as BaseWorkflowBuilder, ([^}]+) \} from "@saintno\/comfyui-sdk";/m,
    'import { WorkflowBuilder as BaseWorkflowBuilder } from "@saintno/comfyui-sdk";\nimport type { $1 } from "@saintno/comfyui-sdk";',
))
log.info(`Fixed ${fixed} duplicate output/input names`)
process.exit(0)   // the proxy's fetches to the ComfyUI server leave keep-alive sockets open that would hang the process otherwise
