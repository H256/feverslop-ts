// Type-checks the project - including the ComfyUI workflows against comfy/nodes.ts, so a missing model,
// a wrong sampler name or a wrong connection is caught before anything is rendered.
// usage: bun run typecheck
const proc = Bun.spawn(['bunx', 'tsc', '--noEmit', '-p', '.'], {stdout: 'pipe', stderr: 'pipe'})
const output = await new Response(proc.stdout).text()
await proc.exited

// an error line plus its indented continuation lines
const errors = output.split(/\n(?=\S)/).filter(e => e.trim() && !e.startsWith('node_modules/'))
if (errors.length) {
    console.log(errors.join('\n'))
    console.log(`\n${errors.length} error(s)`)
    process.exit(1)
}
console.log('No type errors')
