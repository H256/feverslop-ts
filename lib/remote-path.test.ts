import {describe, expect, test} from "bun:test";
import {posix} from "node:path";
import {backslashedRemotePath} from "./render.ts";

describe('paths on the ComfyUI server', () => {
    test('a backslash in an upload target or in the workflow is found - a Linux ComfyUI refuses it', () => {
        const win = 'feverslop-ts/p/assets\\sequence\\characters\\lira\\anchor.png'
        expect(backslashedRemotePath([{to: win}], {})).toBe(win)
        expect(backslashedRemotePath([], {'8': {inputs: {image: win}}})).toBe(win)
    })
    test('paths with / pass, and a backslash in a prompt text is not a path', () => {
        expect(backslashedRemotePath([{to: 'feverslop-ts/p/assets/sequence/characters/lira/anchor.png'}], {'3': {inputs: {text: 'a \\ b', image: 'feverslop-ts/p/assets/a.png'}}})).toBeUndefined()
    })
    test('the upload is split with / on every system', () => {
        expect(posix.dirname('feverslop-ts/p/assets/sequence/characters/lira/anchor.png')).toBe('feverslop-ts/p/assets/sequence/characters/lira')
        expect(posix.basename('feverslop-ts/p/assets/sequence/characters/lira/anchor.png')).toBe('anchor.png')
    })
})
