import {expect, test} from 'bun:test'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve, sep} from 'node:path'

// A module that imports another that imports it back (through values, not only types) is a cycle: what each of them uses may be there
// or not, depending on which was loaded first. New ones are not wanted (#1008): this lists the cycles there are - to be made fewer,
// never more. A cycle that is gone is taken out of the list (the test says so).
const KNOWN = [
    'lib/log.ts > lib/run-record.ts',
    'lib/render.ts > lib/render/servers.ts', // the render modules ask the Renderer (r) for each other: see the facade in lib/render.ts
    'lib/render.ts > lib/render/pictures.ts',
    'lib/render.ts > lib/render/clips.ts',
    'lib/render.ts > lib/render/finishing.ts',
    'lib/editor/kinds.ts > lib/status.ts > lib/editor/preproduction.ts',
]

const files: string[] = []
const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) files.push(resolve(path))
    }
}

/** The cycles of lib/ by value imports (`import type` is gone after compiling), each as the files in a fixed order. */
function cycles(): string[] {
    walk('lib')
    const name = (file: string) => relative('.', file).split(sep).join('/')
    const graph = new Map(
        files.map(file => {
            const text = readFileSync(file, 'utf8')
            const deps = [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^'"]*?from\s+'(\.[^']+\.ts)'/gm)]
                .map(m => resolve(dirname(file), m[1]!))
                .filter(d => files.includes(d))
            return [file, deps] as const
        }),
    )
    const found = new Set<string>()
    const state = new Map<string, number>()
    const stack: string[] = []
    const visit = (node: string) => {
        state.set(node, 1)
        stack.push(node)
        for (const dep of graph.get(node) ?? []) {
            if (state.get(dep) === 1) {
                const loop = stack.slice(stack.indexOf(dep)).map(name)
                // the same cycle however it is entered: started at its smallest file
                const start = loop.indexOf([...loop].sort()[0]!)
                found.add([...loop.slice(start), ...loop.slice(0, start)].join(' > '))
            } else if (!state.has(dep)) visit(dep)
        }
        stack.pop()
        state.set(node, 2)
    }
    for (const file of files) if (!state.has(file)) visit(file)
    return [...found].sort()
}

test('lib/ has no import cycle that is not on the list', () => {
    const now = cycles()
    expect(now.filter(c => !KNOWN.includes(c))).toEqual([])
})

test('a cycle that is gone is taken off the list', () => {
    const now = cycles()
    expect(KNOWN.filter(c => !now.includes(c))).toEqual([])
})
