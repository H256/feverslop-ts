// What a measurement was made with, read from the ComfyUI request graph that is sent anyway: model and LoRA files,
// steps, sampler, scheduler, cfg, attention backend, resolution and frames - and a hash of the graph's structure
// and knobs as the id of the variant. Nothing is labelled by hand: switching a knob (the turbo LoRA off) is
// another variant by itself. Pure - no prompts, no file names of pictures, only settings.

export type GraphNode = { class_type: string, inputs: Record<string, unknown> }
export type Graph = Record<string, GraphNode>

export type GraphSetup = {
    models: string[]                        // checkpoint / unet / vae / text encoder files, "unet_name=file.safetensors"
    loras: { file: string, strength?: number }[]
    steps?: number[]                        // one per sampler node
    cfg?: number[]
    sampler?: string[]
    scheduler?: string[]
    attention?: string[]
    width?: number
    height?: number
    megapixels?: number                     // when the size is chosen on the server (ResolutionSelector)
    pixels?: number
    frames?: number
}

export type GraphDescription = { variant: string, setup: GraphSetup }

const modelFile = /\.(safetensors|ckpt|gguf|pt|pth|bin|sft)$/i
// the inputs that change from job to job without being a knob: they stay out of the variant id
const volatileKeys = /^(seed|noise_seed|prompt|text|string|value|lyrics|tags|image|audio|filename_prefix|start_index|duration|width|height|length|frames|num_frames|megapixels|aspect_ratio)$/i
// nodes that only carry the job's own data (and whose number varies with it)
const dataNodes = /^(Primitive|LoadImage|LoadAudio|TrimAudioDuration)/

const isLink = (value: unknown): value is [string, number] => Array.isArray(value) && value.length === 2 && typeof value[1] === 'number'

/** The plain value of an input, following links through primitive nodes - undefined when it is computed by another node. */
function resolve(graph: Graph, value: unknown, depth = 0): unknown {
    if (!isLink(value)) return value
    const node = graph[String(value[0])]
    if (!node || depth > 5 || !/^Primitive/.test(node.class_type)) return undefined
    return resolve(graph, node.inputs.value, depth + 1)
}

const unique = <T>(values: T[]) => [...new Set(values)]

export function describeGraph(graph: Graph): GraphDescription {
    const nodes = Object.entries(graph).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true})).map(([, node]) => node)
    const setup: GraphSetup = {models: [], loras: []}
    const numbers = (key: string) => nodes.flatMap(n => key in n.inputs ? [resolve(graph, n.inputs[key])] : []).filter((v): v is number => typeof v === 'number')
    const strings = (key: string) => nodes.flatMap(n => key in n.inputs ? [resolve(graph, n.inputs[key])] : []).filter((v): v is string => typeof v === 'string')

    for (const node of nodes) {
        for (const [key, raw] of Object.entries(node.inputs)) {
            const value = resolve(graph, raw)
            if (!key.endsWith('_name') || typeof value !== 'string' || !modelFile.test(value)) continue
            if (key === 'lora_name') {
                const strength = resolve(graph, node.inputs.strength_model)
                setup.loras.push({file: value, ...(typeof strength === 'number' ? {strength} : {})})
            } else {
                setup.models.push(`${key}=${value}`)
            }
        }
        for (const [key, raw] of Object.entries(node.inputs)) {
            const value = resolve(graph, raw)
            if (typeof value === 'string' && /attention|sage|flash/i.test(key) && value.length <= 60) setup.attention = unique([...setup.attention ?? [], `${key}=${value}`])
        }
        if (/sage.?attn|sageattention|flash.?attn|attention/i.test(node.class_type)) setup.attention = unique([...setup.attention ?? [], node.class_type])
    }
    setup.models = unique(setup.models).sort()
    setup.loras.sort((a, b) => a.file.localeCompare(b.file))
    const steps = numbers('steps'), cfg = numbers('cfg'), sampler = strings('sampler_name'), scheduler = strings('scheduler')
    if (steps.length) setup.steps = steps
    if (cfg.length) setup.cfg = cfg
    if (sampler.length) setup.sampler = unique(sampler)
    if (scheduler.length) setup.scheduler = unique(scheduler)

    const width = numbers('width')[0], height = numbers('height')[0], megapixels = numbers('megapixels')[0]
    if (width && height) Object.assign(setup, {width, height, pixels: width * height})
    else if (megapixels) Object.assign(setup, {megapixels, pixels: Math.round(megapixels * 1e6)})
    const frames = [...numbers('length'), ...numbers('num_frames'), ...numbers('frames')][0]
    if (frames) setup.frames = frames

    return {variant: variantId(graph), setup}
}

/** A hash of the graph without what changes per job (prompt, seed, pictures, audio, size, frames) - the same knobs, the same id. */
export function variantId(graph: Graph): string {
    const lines = new Set<string>()
    for (const node of Object.values(graph)) {
        if (dataNodes.test(node.class_type)) continue
        lines.add(node.class_type)
        for (const [rawKey, value] of Object.entries(node.inputs)) {
            const key = rawKey.replace(/\d+/g, '#')
            if (isLink(value)) {
                const source = graph[String(value[0])]
                if (source && !dataNodes.test(source.class_type)) lines.add(`${node.class_type}.${key}<-${source.class_type}`)
            } else if (volatileKeys.test(key)) {
                continue
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                lines.add(`${node.class_type}.${key}=${value}`)
            } else if (typeof value === 'string' && value.length <= 120 && /^[\w.\-/\\: ]+$/.test(value) && !/\s{2,}/.test(value)) {
                lines.add(`${node.class_type}.${key}=${value}`)
            }
        }
    }
    return Bun.hash([...lines].sort().join('\n')).toString(16).slice(0, 10)
}

/** What a node class spends a job's time on - the phases ComfyUI does not report itself are told from the node that runs. */
export type Phase = 'load' | 'sampling' | 'decode' | 'save' | 'other'
export function phaseOf(classType: string): Phase {
    if (/^(LoadImage|LoadAudio)/.test(classType)) return 'other'
    if (/Loader|LoadCheckpoint|LoadModel/.test(classType)) return 'load'
    if (/Sampler|Guider/.test(classType)) return 'sampling'
    if (/Decode/.test(classType)) return 'decode'
    if (/Save|VideoCombine|Preview/.test(classType)) return 'save'
    return 'other'
}

/**
 * Seconds per phase from the order in which ComfyUI reported the nodes it executed: a node runs until the next one
 * starts (nodes answered from the cache never report, so they cost nothing). `endAt` closes the last node.
 */
export function accumulatePhases(events: { classType: string, at: number }[], endAt: number): Partial<Record<Phase, number>> {
    const phases: Partial<Record<Phase, number>> = {}
    events.forEach((event, i) => {
        const until = events[i + 1]?.at ?? endAt
        const phase = phaseOf(event.classType)
        phases[phase] = (phases[phase] ?? 0) + Math.max(0, until - event.at) / 1000
    })
    for (const phase of Object.keys(phases) as Phase[]) phases[phase] = Math.round(phases[phase]! * 10) / 10
    return phases
}

type Stats = { system?: { python_version?: string, comfyui_version?: string, pytorch_version?: string }, devices?: { name: string, vram_total?: number }[] }

/** The GPU and software of a ComfyUI server from its /system_stats: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" → "NVIDIA GeForce RTX 4090". */
export function describeMachine(stats: Stats) {
    const device = stats.devices?.[0]
    const versions = [stats.system?.comfyui_version && `comfyui ${stats.system.comfyui_version}`, stats.system?.pytorch_version && `torch ${stats.system.pytorch_version}`, stats.system?.python_version && `python ${stats.system.python_version.split(' ')[0]}`].filter(Boolean).join(', ')
    return {
        ...(device ? {gpu: device.name.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*\w+$/, '')} : {}),
        ...(device?.vram_total ? {vramGb: Math.round(device.vram_total / 1024 ** 3 * 10) / 10} : {}),
        ...(versions ? {versions} : {}),
    }
}
