import {afterEach, describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadProjectConfig} from "./config.ts";

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true}) })

async function load(config?: object) {
    const dir = mkdtempSync(join(tmpdir(), 'feverslop-config-'))
    dirs.push(dir)
    if (config) writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
    return loadProjectConfig(dir)
}

describe('preview', () => {
    test('defaults to a quarter of the pixels and four steps', async () => {
        expect((await load()).preview).toEqual({scale: 0.25, steps: 4})
    })
    test('a part of it can be set, the rest stays default', async () => {
        expect((await load({preview: {steps: 6}})).preview).toEqual({scale: 0.25, steps: 6})
    })
    test('rejects a scale above 1 and fewer than one step', async () => {
        await expect(load({preview: {scale: 2}})).rejects.toThrow('preview.scale')
        await expect(load({preview: {steps: 0}})).rejects.toThrow('preview.steps')
        await expect(load({preview: 'half'})).rejects.toThrow('preview must be an object')
    })
})
