import {describe, expect, test} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {FALLBACK_NODES, FallbackWorkflowBuilder} from "./nodes-fallback.ts";

const dir = import.meta.dir
const generated = join(dir, 'nodes.ts')
type Builder = Record<string, (inputs: object) => Record<string, unknown>> & { workflow: Record<string, { class_type: string }> }

describe('the fallback for a missing comfy/nodes.ts', () => {
    test('knows every node our workflows use', () => {
        const files = [...readdirSync(join(dir, 'workflows')).map(file => join(dir, 'workflows', file)), join(dir, 'h3-two-pass.ts'), join(dir, 'helpers.ts')]
        const used = files.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/\b(?:wf|workflow)\.([A-Z]\w*)\(/g)].map(match => match[1]!))
        expect(used.length).toBeGreaterThan(0)
        expect([...new Set(used)].filter(node => !FALLBACK_NODES[node])).toEqual([])
    })

    test('builds a node with its outputs', () => {
        const wf = new FallbackWorkflowBuilder() as unknown as Builder
        const node = wf.LoadImage!({image: 'a.png'})
        expect(node.IMAGE).toEqual([node.__id, 0])
        expect(node.MASK).toEqual([node.__id, 1])
        expect(wf.workflow[node.__id as string]).toMatchObject({class_type: 'LoadImage', inputs: {image: 'a.png'}})
    })

    test('says what to do about a node it does not know', () => {
        const wf = new FallbackWorkflowBuilder() as unknown as Builder
        expect(() => wf.SomeCustomNode!({})).toThrow('bun run comfy:types')
    })

    test.if(existsSync(generated))('has the outputs of the generated file', async () => {
        const {WorkflowBuilder} = await import(generated)
        for (const [name, outputs] of Object.entries(FALLBACK_NODES)) {
            const node = (new WorkflowBuilder() as Builder)[name]?.({}) ?? {}
            const fallback = (new FallbackWorkflowBuilder() as unknown as Builder)[name]!({})
            const {inputs: _, ...withoutPaths} = node
            expect([name, withoutPaths]).toEqual([name, fallback])
            expect(outputs).toEqual(Object.keys(fallback).filter(key => key !== '__id'))
        }
    })
})
