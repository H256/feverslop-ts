import {existsSync, renameSync} from "node:fs";
import {basename, dirname, resolve} from "node:path";
import {languageName} from "../config.ts";
import type {AskOptions} from "../llm.ts";
import {dialogueOf, LEAD_IN_SEC} from "./coverage.ts";
import type {FilmClipRequest} from "./compose.ts";
import {speechSeconds} from "./screenplay.ts";
import type {Screenplay} from "./types.ts";

// Subtitles of the film: <id>.srt and a track in the mp4. The text is the translation of a line - from the screenplay itself ("script"), or
// translated by the language model into the language in config.json (subtitles). The timing is an estimate - the clip starts a line
// about a second into its shot and speaks it at the speed planned for it (the same estimate the shot planning uses); nothing listens to the
// finished clips (Whisper is too brittle to build on) - the cues are right to about a second, which is what a reader needs.

export type Cue = { start: number, end: number, text: string }

/** "s3:2" - the 3rd scene's 3rd dialogue line. */
export const lineKey = (sceneId: string, line: number) => `${sceneId}:${line}`

/** The text shown for every line that has one: the translations of the screenplay, or those of the translation step. */
export function subtitleTexts(screenplay: Screenplay, translated: Record<string, string> | undefined, mode: string): Record<string, string> {
    if (mode === 'off') return {}
    const texts: Record<string, string> = {}
    for (const scene of screenplay.scenes) {
        dialogueOf(scene).forEach((line, n) => {
            const text = mode === 'script' ? (line.type === 'dialogue' ? line.translation : undefined) : translated?.[lineKey(scene.id, n)]
            if (text) texts[lineKey(scene.id, n)] = text
        })
    }
    return texts
}

/**
 * The cues of the film. starts: the second of the film every clip starts at. A line spoken over several clips (a long line cut at its sentence
 * ends) is one cue from the start of its first part to the end of its last.
 */
export function subtitleCues(clips: FilmClipRequest[], starts: number[], texts: Record<string, string>): Cue[] {
    const spans = new Map<string, Cue>()
    clips.forEach((clip, i) => {
        const clipEnd = starts[i]! + clip.seconds
        for (const line of clip.dialogue) {
            const text = texts[lineKey(clip.sceneId, line.line)]
            if (!text) continue
            const start = starts[i]! + line.at + LEAD_IN_SEC
            const end = Math.min(clipEnd, start + Math.max(1, speechSeconds(line.text) - 0.5))
            const known = spans.get(lineKey(clip.sceneId, line.line))
            spans.set(lineKey(clip.sceneId, line.line), known ? {start: Math.min(known.start, start), end: Math.max(known.end, end), text} : {start, end, text})
        }
    })
    const cues = [...spans.values()].sort((a, b) => a.start - b.start)
    // a cue never runs into the next one
    cues.forEach((cue, i) => { if (cues[i + 1] && cue.end > cues[i + 1]!.start - 0.05) cue.end = Math.max(cue.start + 0.5, cues[i + 1]!.start - 0.05) })
    return cues
}

const time = (seconds: number) => {
    const ms = Math.round(seconds * 1000)
    const part = (n: number, width: number) => String(Math.floor(n)).padStart(width, '0')
    return `${part(ms / 3600000, 2)}:${part(ms / 60000 % 60, 2)}:${part(ms / 1000 % 60, 2)},${part(ms % 1000, 3)}`
}

export const toSrt = (cues: Cue[]) => cues.map((cue, i) => `${i + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.text}\n`).join('\n')

/** The film with the subtitles as a (switchable) track - the video and the sound are copied, not encoded again. */
export async function muxSubtitles(film: string, srt: string, language?: string) {
    const partial = `${film}.subs.mp4`
    const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-i', film, '-i', srt, '-map', '0:v', '-map', '0:a', '-map', '1:s', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', `title=${(language && languageName(language)) || 'Subtitles'}`, '-movflags', '+faststart', partial], {stdout: 'pipe', stderr: 'pipe'})
    const stderr = new Response(proc.stderr).text()
    if (await proc.exited !== 0) throw new Error(`ffmpeg could not add the subtitles:\n${await stderr}`)
    if (existsSync(partial)) renameSync(partial, film)
}

/**
 * The subtitles burned into the picture: the video is encoded once more, the sound is copied. The size is relative to the picture (libass
 * lays an srt out on a 288-line page), white with a dark outline, at the bottom.
 */
export async function burnSubtitles(film: string, srt: string) {
    const partial = `${film}.burn.mp4`
    // run next to the files: a Windows path with a drive letter has to be escaped in a filter, a plain file name does not
    const cwd = dirname(resolve(film))
    const style = 'Fontsize=15,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=1.2,Shadow=0,MarginV=14,Alignment=2'
    const proc = Bun.spawn(['ffmpeg', '-y', '-v', 'error', '-i', basename(film), '-vf', `subtitles=${basename(srt)}:force_style='${style}'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', basename(partial)], {cwd, stdout: 'pipe', stderr: 'pipe'})
    const stderr = new Response(proc.stderr).text()
    if (await proc.exited !== 0) throw new Error(`ffmpeg could not burn the subtitles in:
${await stderr}`)
    renameSync(partial, film)
}

/** The translation of every line that is not spoken in the subtitle language, one answer for the whole film. */
export function subtitlePrompt(screenplay: Screenplay, language: string): { lines: { key: string, text: string }[], options: AskOptions } {
    const lines = screenplay.scenes.flatMap(scene => dialogueOf(scene).flatMap((line, n) =>
        line.type === 'dialogue' && (line.language ?? screenplay.language) !== language ? [{key: lineKey(scene.id, n), text: line.text, speaker: line.speaker}] : []))
    return {
        lines,
        options: {
            maxTokens: 8192,
            input: `Translate every line into ${languageName(language) ?? language}, for subtitles.
Answer only with JSON: {"<key>": "<translation>", ...} - one entry per key.
${lines.map(l => `${l.key} (${l.speaker}): ${l.text}`).join('\n')}`,
            instructions: 'You translate the dialogue of a film for subtitles: faithful, natural, short enough to read in two lines; names stay as they are. Answer only with the JSON.',
        },
    }
}
