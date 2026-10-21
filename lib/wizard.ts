// Prompt helpers for the interactive CLIs (@clack/prompts) - the same questions tools/init.ts asks for the music-video
// wizard, here as a module so tools/film-init.ts can use them. tools/init.ts keeps its own copies untouched.
import * as p from "@clack/prompts";
import {existsSync} from "node:fs";
import {createInterface} from "node:readline/promises";
import type {Resolution} from "../comfy/helpers.ts";
import {log, styles} from "./log.ts";
import {STYLES} from "./styles.ts";

// cancelled with Ctrl+C / Esc
export function answer<T>(value: T): Exclude<T, symbol> {
    if (p.isCancel(value)) {
        log.cancel('Cancelled - nothing written')
        process.exit(1)
    }
    return value as Exclude<T, symbol>
}

/** Text from a file path or typed on the spot (clack's text prompt is single-line, unsuited to a story or a screenplay). */
export async function askText(label: string, options: { required?: boolean } = {}): Promise<string | undefined> {
    const mode = answer(await p.select({
        message: label,
        options: [
            {value: 'type', label: 'Type it now'},
            {value: 'file', label: 'Read from a file'},
            ...(options.required ? [] : [{value: 'skip', label: 'Skip'}]),
        ],
    }))
    if (mode === 'skip') return undefined
    if (mode === 'file') return readFromFile()
    return multiline(label)
}

async function readFromFile() {
    const path = answer(await p.text({message: 'File path', validate: v => v && existsSync(v) ? undefined : 'file not found'}))
    return (await Bun.file(path).text()).trim()
}

/** The film style for input/style.txt: typed, read from a file, taken from the built-in list - or left to the first run. */
export async function askStyle(): Promise<string | undefined> {
    const mode = answer(await p.select({
        message: 'Visual style',
        options: [
            {value: 'skip', label: 'Skip', hint: 'a style from the built-in list that fits the story is picked later'},
            {value: 'list', label: 'Choose from the built-in list', hint: `${STYLES.length} styles`},
            {value: 'type', label: 'Type it now'},
            {value: 'file', label: 'Read from a file'},
        ],
    }))
    if (mode === 'skip') return undefined
    if (mode === 'file') return readFromFile()
    if (mode === 'type') return multiline('Visual style')

    const groups = [...new Set(STYLES.map(s => s.group))]
    const group = answer(await p.select({message: 'Kind of style', options: groups.map(g => ({value: g, label: g, hint: `${STYLES.filter(s => s.group === g).length}`}))}))
    const picked = answer(await p.select({
        message: group,
        maxItems: 12,
        options: STYLES.filter(s => s.group === group).map(s => ({value: s.id, label: s.name, hint: s.text.slice(0, 60)})),
    }))
    return STYLES.find(s => s.id === picked)!.text
}

/**
 * Clack has no multiline prompt - reads plain lines until two in a row are empty, after the current clack prompt
 * closed. A single empty line doesn't end it: stories and screenplays routinely have blank lines in them.
 */
export async function multiline(label: string): Promise<string> {
    log.prompt(styles.muted(`  ${label} - end with two empty lines (press Enter twice when done):`))
    const rl = createInterface({input: process.stdin})
    const lines: string[] = []
    let blankStreak = 0
    for await (const line of rl) {
        if (line === '') {
            blankStreak++
            if (blankStreak >= 2 && lines.length) break
        } else {
            blankStreak = 0
        }
        lines.push(line)
    }
    rl.close()
    while (lines.length && lines.at(-1) === '') lines.pop()
    return lines.join('\n').trim()
}

export async function askResolution(label: string): Promise<Resolution> {
    const mode = answer(await p.select({
        message: label,
        options: [
            {value: 'default', label: 'Workflow default', hint: 'default'},
            {value: 'megapixels', label: 'Megapixels (e.g. 1.1)'},
            {value: 'fixed', label: 'Fixed size (WIDTHxHEIGHT)'},
        ],
    }))
    if (mode === 'default') return -1
    if (mode === 'megapixels') return Number(answer(await p.text({message: 'Megapixels', placeholder: '1.1', validate: v => Number(v) > 0 ? undefined : 'a positive number'})))
    return answer(await p.text({message: 'Size', placeholder: '1920x1088', validate: v => v && /^\d+x\d+$/.test(v) ? undefined : 'e.g. 1920x1088'})) as `${number}x${number}`
}
