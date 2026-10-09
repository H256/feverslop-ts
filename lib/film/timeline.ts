import {FPS} from "../frames.ts";

// The film as an edit decision list (CMX 3600) - every editor (DaVinci Resolve, Premiere, Final Cut via import, ...) reads it: the clips in
// order on one video track and one audio track, cut exactly as assemble.ts cuts them. A clip that goes on from the last frame of the one before
// leaves its first frame out (it is the same picture as the last of the one before).

const timecode = (frame: number) => {
    const f = frame % FPS
    const s = Math.floor(frame / FPS) % 60
    const m = Math.floor(frame / (FPS * 60)) % 60
    const h = Math.floor(frame / (FPS * 3600))
    return [h, m, s, f].map(n => String(n).padStart(2, '0')).join(':')
}

export function timelineEdl(title: string, clips: { id: string, frames: number, startsFrom?: string }[]) {
    const lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', '']
    let record = 0
    clips.forEach((clip, i) => {
        const skip = clip.startsFrom !== undefined && clip.startsFrom === clips[i - 1]?.id ? 1 : 0
        const length = clip.frames - skip
        const edit = String(i + 1).padStart(3, '0')
        const times = `${timecode(skip)} ${timecode(clip.frames)} ${timecode(record)} ${timecode(record + length)}`
        lines.push(`${edit}  AX       V     C        ${times}`, `${edit}  AX       AA    C        ${times}`, `* FROM CLIP NAME: ${clip.id}.mp4`, '')
        record += length
    })
    return `${lines.join('\n')}\n`
}
