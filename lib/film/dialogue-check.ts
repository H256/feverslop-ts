import {existsSync, mkdirSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";
import {probeDuration} from "../assemble.ts";
import {runProcess} from "../process.ts";
import {log} from "../log.ts";
import type {FilmClipRequest} from "./compose.ts";

// Does every clip say what the script says, and nothing else? The sound of all rendered clips is joined with a few seconds of
// silence between them and transcribed once with Whisper (tools/vocals.py draft - no lyrics given, it writes down what it hears), the
// segments are given back to their clips by time, and the words are compared with the dialogue of the clip.

const GAP_SEC = 3
const MIN_EXTRA_WORDS = 2       // a stray word is Whisper's, a few words are speech the model made up

export type ClipCheck = {
    id: string,
    status: 'ok' | 'cut' | 'wrong' | 'extra' | 'silent-but-heard',
    expected: string,
    heard: string,
    missing: string[],      // words of the script that were not heard
    extra: string[],        // words that were heard and are not in the script
}

const words = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)

// "hab" and "habe", "traum" and "träumt": close enough is the same word
function same(a: string, b: string) {
    if (a === b) return true
    const [short, long] = a.length <= b.length ? [a, b] : [b, a]
    if (short.length >= 3 && long.startsWith(short)) return true
    if (short.length < 4) return false
    return distance(a, b) / long.length <= 0.34
}

function distance(a: string, b: string) {
    const row = Array.from({length: b.length + 1}, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0]!
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const keep = row[j]!
            row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
            prev = keep
        }
    }
    return row[b.length]!
}

/** Aligns the words that were heard to the words of the script (longest common subsequence): what is missing, and what is extra. */
export function compareWords(expected: string[], heard: string[]) {
    const n = expected.length, m = heard.length
    const table = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        table[i]![j] = same(expected[i]!, heard[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
    const missing: string[] = [], extra: string[] = []
    let i = 0, j = 0
    while (i < n && j < m) {
        if (same(expected[i]!, heard[j]!)) { i++; j++ }
        else if (table[i + 1]![j]! >= table[i]![j + 1]!) missing.push(expected[i++]!)
        else extra.push(heard[j++]!)
    }
    missing.push(...expected.slice(i))
    extra.push(...heard.slice(j))
    return {missing, extra}
}

export function judge(expected: string, heard: string): Omit<ClipCheck, 'id'> {
    const e = words(expected), h = words(heard)
    const {missing, extra} = compareWords(e, h)
    if (!e.length) return {status: extra.length >= MIN_EXTRA_WORDS ? 'silent-but-heard' : 'ok', expected, heard, missing, extra}
    // the end of the last line is what is lost when a clip is cut: everything missing sits at the end of the script
    const endsEarly = missing.length > 0 && e.slice(e.length - missing.length).join(' ') === missing.join(' ')
    const status = extra.length >= MIN_EXTRA_WORDS ? 'extra' : missing.length === 0 ? 'ok' : endsEarly ? 'cut' : 'wrong'
    return {status, expected, heard, missing, extra}
}

export async function checkDialogue({clips, projectDir, language, work}: {
    clips: FilmClipRequest[],
    projectDir: string,
    language: string,
    work: string,
}): Promise<ClipCheck[]> {
    const rendered = clips.filter(c => existsSync(join(projectDir, 'videos', `${c.id}.mp4`)))
    if (!rendered.length) throw new Error('no clip is rendered yet - nothing to check')
    rmSync(work, {recursive: true, force: true})
    mkdirSync(work, {recursive: true})

    // every clip's whole sound (also the frames after the planned end), mono 16 kHz, with a gap of silence behind it
    const silence = join(work, 'silence.wav')
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(GAP_SEC), silence], {errorMessage: err => `ffmpeg: ${err}`})
    const offsets: { clip: FilmClipRequest, start: number, end: number }[] = []
    // the concat demuxer reads relative paths from the folder of the list file - absolute ones mean the same everywhere
    const entry = (file: string) => `file '${resolve(file).replaceAll('\\', '/')}'`
    const list: string[] = [entry(silence)]
    let cursor = GAP_SEC
    for (const clip of rendered) {
        const wav = join(work, `${clip.id}.wav`)
        await runProcess(['ffmpeg', '-y', '-v', 'error', '-i', join(projectDir, 'videos', `${clip.id}.mp4`), '-vn', '-ac', '1', '-ar', '16000', wav], {errorMessage: err => `ffmpeg could not read the sound of ${clip.id}:\n${err}`})
        const seconds = await probeDuration(wav)
        offsets.push({clip, start: cursor, end: cursor + seconds + GAP_SEC})
        list.push(entry(wav), entry(silence))
        cursor += seconds + GAP_SEC
    }
    const listFile = join(work, 'list.txt')
    await Bun.write(listFile, list.join('\n'))
    const all = join(work, 'all.wav')
    await runProcess(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', all], {errorMessage: err => `ffmpeg could not join the sound of the clips:\n${err}`})

    log.step('Whisper', `${rendered.length} clips, ${Math.round(cursor)} s of sound - the first run downloads the model (~3 GB)`)
    // python writes in the console's code page unless told otherwise - German umlauts
    const proc = Bun.spawn(['uv', 'run', 'tools/vocals.py', 'draft', all, language], {stdout: 'pipe', stderr: 'inherit', env: {...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1'}})
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) throw new Error('tools/vocals.py draft failed - see the output above')

    const heard = new Map<string, string[]>(rendered.map(c => [c.id, []]))
    for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^\[(\d+):(\d+)\]\s*(.+)$/)
        if (!match) continue
        const at = Number(match[1]) * 60 + Number(match[2])
        const owner = offsets.find(o => at >= o.start - 1 && at < o.end - 1)
        if (owner) heard.get(owner.clip.id)!.push(match[3]!)
    }
    return rendered.map(clip => ({id: clip.id, ...judge(clip.dialogue.map(d => d.text).join(' '), (heard.get(clip.id) ?? []).join(' '))}))
}

