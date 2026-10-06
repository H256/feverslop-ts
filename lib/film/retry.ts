import {existsSync, mkdirSync, renameSync} from "node:fs";
import {join} from "node:path";
import {log, styles} from "../log.ts";
import {type FilmClipRequest, filmBoundaryFrame} from "./compose.ts";
import type {ClipCheck} from "./dialogue-check.ts";

/**
 * Clips the dialogue check flags are rendered again, up to `retries` times (a new seed every time - the model is not deterministic),
 * and checked again. It costs GPU time: only on request (--retry=N). A clip that goes on from the last frame of the one before makes
 * every clip behind it in its chain stale when it is rendered again, so those are rendered again with it. What a render replaced is kept
 * in old/attempts/.
 */
export async function retryFlagged({requests, selected, projectDir, retries, render, check}: {
    requests: FilmClipRequest[],
    selected: FilmClipRequest[],
    projectDir: string,
    retries: number,
    render: (clips: FilmClipRequest[]) => Promise<unknown>,
    check: (clips: FilmClipRequest[]) => Promise<ClipCheck[]>,
}): Promise<ClipCheck[]> {
    const rendered = (clips: FilmClipRequest[]) => clips.filter(c => existsSync(join(projectDir, 'videos', `${c.id}.mp4`)))
    const order = new Map(requests.map((r, i) => [r.id, i]))
    let results = await check(rendered(selected))

    for (let attempt = 1; attempt <= retries; attempt++) {
        const bad = results.filter(r => r.status !== 'ok')
        if (!bad.length) break

        // each flagged clip, and the clips that start on the last frame of it or of one of those
        const again = new Set<string>()
        for (const r of bad) {
            let id = r.id
            again.add(id)
            for (let next = requests.find(c => c.startsFrom === id); next; next = requests.find(c => c.startsFrom === next!.id)) again.add(next.id)
        }
        const clips = rendered(requests.filter(c => again.has(c.id)))
        log.step('Again', `${attempt} of ${retries}: ${clips.map(c => c.id).join(', ')} ${styles.muted(`(${bad.map(r => r.id).join(', ')} flagged)`)}`)

        for (const clip of clips) {
            const keep = join(projectDir, 'old', 'attempts', `${clip.id}-a${attempt}`)
            mkdirSync(keep, {recursive: true})
            for (const file of [join('videos', `${clip.id}.mp4`), join('videos', `${clip.id}.mp4.json`), filmBoundaryFrame(clip.id), filmBoundaryFrame(clip.id).replace(/_lf\.png$/, '_ff.png')]) {
                const from = join(projectDir, file)
                if (existsSync(from)) renameSync(from, join(keep, file.split(/[\\/]/).at(-1)!))
            }
        }
        await render(clips)

        const fresh = await check(rendered(clips))
        results = [...results.filter(r => !again.has(r.id)), ...fresh]
    }
    return results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}
