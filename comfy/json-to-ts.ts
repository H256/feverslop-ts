// Converts a ComfyUI workflow in API format into a draft workflow file for comfy/workflows/.
// usage: bun comfy/json-to-ts.ts <workflow-api.json> <name> --kind=image|video|audio [--force] [--comfy=http://host:8188]
// See docs/custom-workflows.md for the steps after the conversion.
//
// Reads output names and dropdown values from the running server, and the builder method
// names from comfy/nodes.ts - so run `bun run comfy:types` first after installing nodes.
import {existsSync} from "node:fs";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {fetchNodeList, nodeServer} from "./node-list.ts";

const {values: args, positionals: [source, name]} = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {kind: {type: 'string', default: 'image'}, force: {type: 'boolean', default: false}, comfy: {type: 'string'}},
})
if (!source || !name || !['image', 'video', 'audio'].includes(args.kind)) {
    console.error('usage: bun comfy/json-to-ts.ts <workflow-api.json> <name> --kind=image|video|audio [--force] [--comfy=http://host:8188]')
    process.exit(1)
}
const target = join(import.meta.dir, 'workflows', `${name}.ts`)
if (existsSync(target) && !args.force) {
    console.error(`${target} exists - use --force to overwrite`)
    process.exit(1)
}

type ApiNode = { class_type: string, inputs: Record<string, unknown>, _meta?: { title?: string } }
const json = await Bun.file(source).json()
const graph: Record<string, ApiNode> = json.prompt ?? json
if (Object.values(graph).some(n => typeof n?.class_type !== 'string')) {
    console.error(`${source} is not in API format - export it with "Export (API)" in ComfyUI`)
    process.exit(1)
}

const objectInfo = await fetchNodeList(await nodeServer(args.comfy))

// builder method per node type, as cfli named them: "easy saveText" -> EasySaveText
const nodesFile = join(import.meta.dir, 'nodes.ts')
if (!existsSync(nodesFile)) {
    console.error('comfy/nodes.ts is missing - run: bun run comfy:types')
    process.exit(1)
}
// every method starts with `this.addNode("<class_type>", inputs)` on its first line
const methods = new Map([...(await Bun.file(nodesFile).text()).matchAll(/^ {2}(\w+)\(inputs[^\n]*\r?\n\s+const id = this\.addNode\(("(?:[^"\\]|\\.)*")/gm)]
    .map(([, method, classType]) => [JSON.parse(classType!) as string, method!]))

const isLink = (value: unknown): value is [string, number] => Array.isArray(value) && value.length === 2 && typeof value[1] === 'number'
const identifier = /^[A-Za-z_$][\w$]*$/
const access = (key: string) => identifier.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
const property = (key: string) => identifier.test(key) ? key : JSON.stringify(key)
const variables = new Map<string, string>()
const variable = (id: string) => variables.get(id)!
const widgetTypes = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'])

function inputSpec(classType: string, input: string): unknown[] | undefined {
    const info = objectInfo[classType]?.input
    return info?.required?.[input] ?? info?.optional?.[input]
}

function renderValue(classType: string, input: string, value: unknown): string {
    const spec = inputSpec(classType, input)
    if (isLink(value)) {
        const [id, slot] = value
        const source = objectInfo[graph[id]!.class_type]
        const outputName = source?.output_name?.[slot] ?? source?.output?.[slot]
        if (!outputName) return `${variable(id)} /* output ${slot}: unknown node */`
        const ref = `${variable(id)}${access(outputName)}`
        // a node output into a widget (e.g. PrimitiveInt -> width) - allowed in ComfyUI, not in the types
        if (spec && (Array.isArray(spec[0]) || widgetTypes.has(spec[0] as string))) return `widget(${ref})`
        // wildcard outputs ("*", e.g. VRAMCleanup) return anything - cast so the next node type-checks
        return source?.output?.[slot] === '*' ? `${ref} as never` : ref
    }
    // values the server doesn't list (uploaded files, dynamic lists) need dyn()
    const options = Array.isArray(spec?.[0]) ? spec[0] : spec?.[0] === 'COMBO' ? (spec[1] as { options?: unknown[] })?.options : undefined
    if (options && typeof value === 'string' && !options.includes(value)) return `dyn(${JSON.stringify(value)})`
    return JSON.stringify(value)
}

// nodes in dependency order, so every variable exists before it is used
const lines: string[] = []
const visited = new Set<string>()
const outputNodes: string[] = []

function emit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const node = graph[id]!
    for (const value of Object.values(node.inputs)) if (isLink(value) && graph[value[0]]) emit(value[0])

    const info = objectInfo[node.class_type]
    const base = node.class_type.replace(/[^A-Za-z0-9]/g, '')
    variables.set(id, `${base.charAt(0).toLowerCase()}${base.slice(1)}_${id}`)

    const declared: string[] = []
    const extra: string[] = []
    for (const [input, value] of Object.entries(node.inputs)) {
        const line = `${property(input)}: ${renderValue(node.class_type, input, value)}`
        if (inputSpec(node.class_type, input)) declared.push(line)
        else extra.push(line)
    }

    const title = node._meta?.title
    if (title?.startsWith('#')) lines.push(`    // TODO ${title}: wire opts in here`)
    else if (title && title !== info?.display_name) lines.push(`    // ${title}`)
    const method = methods.get(node.class_type)
    if (!info || !method) {
        lines.push(`    // WARNING: ${node.class_type} is not installed - install it and run: bun run comfy:types`)
        lines.push(`    const ${variable(id)} = (wf as any)[${JSON.stringify(node.class_type)}]({${declared.join(', ')}})`)
    } else {
        lines.push(`    const ${variable(id)} = wf.${method}({${declared.join(', ')}})`)
    }
    // autogrow slots and widgets that only exist for some settings aren't in the node types
    if (extra.length) lines.push(`    withInputs(wf, ${variable(id)}, {${extra.join(', ')}})`)
    if (info?.output_node) outputNodes.push(id)
}

for (const id of Object.keys(graph)) emit(id)

const optionsType = args.kind === 'image' ? 'ImageWorkflowOptions' : args.kind === 'audio' ? 'AudioWorkflowOptions' : 'VideoWorkflowOptions'
const output = outputNodes.at(-1)
const code = `// Draft generated from ${source} by comfy/json-to-ts.ts - see docs/custom-workflows.md
// 1. replace the TODO values with opts, 2. check with: bun run typecheck, 3. set it in a project's config.json
import {afterCleanup, dyn, resolution, type ${optionsType}, widget, withInputs, WorkflowBuilder, type WorkflowResult} from "../helpers.ts";

export default function ${name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => c?.toUpperCase() ?? '')}(opts: ${optionsType}): WorkflowResult {
    const wf = new WorkflowBuilder()

${lines.join('\n')}

${outputNodes.length > 1 ? `    // output nodes: ${outputNodes.map(variable).join(', ')} - pick the one whose files should be downloaded\n` : ''}    return {workflow: wf, output: ${output ? `${variable(output)}.__id` : `'' /* TODO: no output node found */`}}
}
`
await Bun.write(target, code)
console.log(`Wrote ${target} (${Object.keys(graph).length} nodes${output ? `, output ${variable(output)}` : ''})`)
