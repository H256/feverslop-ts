// ComfyUI answers a workflow it can't run with 400 and a JSON body: which nodes are not installed, which model a loader
// doesn't know. Shown raw it is one long line - and the run record keeps only the first 200 characters of a failure, which
// are all the generic "Prompt outputs failed validation". So the names come first, in one line.

type NodeError = {type?: string; message?: string; details?: string; extra_info?: Record<string, unknown>}
type Rejection = {error?: NodeError; node_errors?: Record<string, {errors?: NodeError[]; class_type?: string}>}

const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/**
 * "ComfyUI gpu1 rejected the workflow - node not installed: MinimaxH3LatentUpscaler3D; model not on the server:
 * minimax_h3_latent_upscaler_3d_bf16.safetensors (model_name of UpscaleModelLoader)", the other problems after it.
 * A body that is not what ComfyUI sends comes back as it is.
 */
export function describeRejection(server: string, body: string): string {
    const head = `ComfyUI ${server} rejected the workflow - `
    let parsed: Rejection
    try {
        parsed = JSON.parse(body)
    } catch {
        return head + body
    }
    if (!parsed || typeof parsed !== 'object') return head + body

    const nodes = new Set<string>()
    const models = new Set<string>()
    const others = new Set<string>()
    const note = (error: NodeError, classType?: string) => {
        const info = error.extra_info ?? {}
        if (error.type === 'missing_node_type') nodes.add(text(info.class_type ?? classType ?? error.message))
        else if (error.type === 'value_not_in_list' && info.received_value !== undefined)
            models.add(`${text(info.received_value)} (${text(info.input_name ?? 'input')} of ${classType ?? 'a node'})`)
        else others.add([classType, error.message, error.details].filter(Boolean).join(': '))
    }
    if (parsed.error) note(parsed.error)
    for (const node of Object.values(parsed.node_errors ?? {})) for (const error of node.errors ?? []) note(error, node.class_type)

    // the generic summary says nothing the lists don't
    if (nodes.size + models.size) others.delete([undefined, parsed.error?.message, parsed.error?.details].filter(Boolean).join(': '))
    for (const other of [...others]) if (other === 'Prompt outputs failed validation') others.delete(other)

    const parts = [
        ...(nodes.size ? [`node not installed: ${[...nodes].join(', ')}`] : []),
        ...(models.size ? [`model not on the server: ${[...models].join(', ')}`] : []),
        ...(others.size ? [[...others].join('; ')] : []),
    ]
    return head + (parts.length ? parts.join(' - ') : body)
}
