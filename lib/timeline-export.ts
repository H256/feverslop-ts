// Exports the cut as an editable timeline - `bun index.ts --export=mlt,openshot`. The clips stay separate files on
// one video track, each trimmed to the frames it owns (see assembleFinal), with the song on an audio track, so
// every cut can be adjusted by hand in Shotcut/Kdenlive (.mlt) or OpenShot (.osp). Paths are relative to the
// project file, so the project folder can be moved or zipped. Nothing here renders anything.
import {existsSync} from "node:fs";
import {join, relative} from "node:path";
import {log} from "./log.ts";
import {FPS, formatTimestamp, secondsAt} from "./frames.ts";
import type {ClipRequest} from "./compose.ts";
import {formatSlotRanges, probeVideo} from "./assemble.ts";

export const EXPORT_FORMATS = ['mlt', 'openshot'] as const
export type ExportFormat = typeof EXPORT_FORMATS[number]
export const EXPORT_FILES: Record<ExportFormat, string> = {mlt: 'timeline.mlt', openshot: 'timeline.osp'}

type Item = { clip: ClipRequest, file: string, frames: number }  // frames: the part of the rendered file the clip owns
type Timeline = { items: Item[], width: number, height: number, totalFrames: number, song?: string, songName: string, projectName: string }

export async function exportTimelines({formats, clips, projectDir, projectName, songFile, songAudio}: {
    formats: ExportFormat[],
    clips: ClipRequest[],
    projectDir: string,
    projectName: string,
    songFile: string,
    songAudio: boolean,     // true: the original song is the soundtrack, false: the clips' own audio
}): Promise<Record<ExportFormat, string>> {
    const files = clips.map(c => join(projectDir, 'videos', `${c.id}.mp4`))
    const missing = clips.filter((_, i) => !existsSync(files[i]!)).map(c => c.id)
    if (missing.length) throw new Error(`Can't export - ${missing.length} of ${clips.length} clip(s) not rendered yet: ${formatSlotRanges(missing)}\nRender them first: --render=videos --only=${missing.join(',')}`)

    const infos = await Promise.all(files.map(probeVideo))
    const {width, height} = infos[0]!
    const items = clips.map((clip, i) => {
        if (infos[i]!.frames < clip.frames) throw new Error(`videos/${clip.id}.mp4 has ${infos[i]!.frames} frames, but the clip needs ${clip.frames} - delete it and render again`)
        return {clip, file: files[i]!, frames: clip.frames}
    })
    // the clips normally tile the song, but a section without a single bar produces no clip - the gap stays a gap
    // (OpenShot places every clip at its frameStart, MLT gets a blank), so the song stays in sync under both
    let cursor = 0
    for (const {clip, frames} of items) {
        if (clip.frameStart !== cursor) log.warn(`${clip.id} starts at ${formatTimestamp(secondsAt(clip.frameStart))} but the clip before it ends at ${formatTimestamp(secondsAt(cursor))} - the gap is kept in the timeline`)
        cursor = clip.frameStart + frames
    }
    const timeline: Timeline = {
        items, width, height, projectName,
        totalFrames: cursor,
        song: songAudio ? songFile : undefined,
        songName: songFile.split('/').at(-1)!,
    }

    const written = {} as Record<ExportFormat, string>
    for (const format of formats) {
        const target = join(projectDir, EXPORT_FILES[format])
        await Bun.write(target, format === 'mlt' ? mltProject(timeline, target) : openShotProject(timeline, target))
        written[format] = target
    }
    return written
}

const rel = (file: string, projectFile: string) => relative(join(projectFile, '..'), file).split('\\').join('/')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c]!)
const prop = (name: string, value: string | number, pad = '    ') => `${pad}<property name="${name}">${esc(String(value))}</property>`

// what a clip is about, shown as the clip's comment in Shotcut
function clipComment(clip: ClipRequest) {
    return [`${clip.section} · ${clip.beatId}`, ...clip.shots.map(s => `${s.label}: ${s.framing}, ${s.camera}`)].join('\n')
}

function mltProject({items, width, height, totalFrames, song, songName, projectName}: Timeline, target: string) {
    const last = Math.max(0, totalFrames - 1)
    // one chain per clip, cut to the frames the clip owns
    const chains = items.map(({clip, file, frames}) => `  <chain id="${clip.id}" in="0" out="${frames - 1}">
${prop('resource', rel(file, target))}
${prop('mlt_service', 'avformat')}
${prop('shotcut:caption', clip.id)}
${prop('shotcut:comment', clipComment(clip))}
  </chain>`).join('\n')
    // a blank for every gap before a clip - the clips sit at their song position, like in the OpenShot project
    let cursor = 0
    const entries = items.map(({clip, frames}) => {
        const gap = clip.frameStart - cursor
        cursor = clip.frameStart + frames
        return `${gap > 0 ? `    <blank length="${gap}"/>\n` : ''}    <entry producer="${clip.id}" in="0" out="${frames - 1}"/>`
    }).join('\n')
    const notes = [
        `Project: ${projectName}`,
        'Pipeline: FeverSlop TS',
        `Clips: ${items.length}`,
        `Profile: ${width}x${height} @ ${FPS} fps`,
        `Duration: ${formatTimestamp(secondsAt(totalFrames))}`,
        song ? 'Video track: V1 - clips (their own audio is muted, the song is on A1)' : 'Video track: V1 - clips (with their own audio, "songAudio" is false)',
        ...(song ? [`Audio track: A1 - ${songName}`] : []),
        'Regenerate: bun index.ts <project> --export=mlt',
    ].join('\n')
    return `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.0.0" title="FeverSlop timeline" producer="main_bin">
  <profile description="Custom ${width}x${height} ${FPS} fps" width="${width}" height="${height}" frame_rate_num="${FPS}" frame_rate_den="1" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${width}" display_aspect_den="${height}" colorspace="709"/>
${chains}
${song ? `  <chain id="song" in="0" out="${last}">
${prop('resource', rel(song, target))}
${prop('mlt_service', 'avformat')}
${prop('shotcut:caption', songName)}
  </chain>\n` : ''}  <playlist id="playlist0" autoclose="1">
${prop('shotcut:video', 1)}
${prop('shotcut:name', 'V1')}
${entries}
  </playlist>
${song ? `  <playlist id="playlist1" autoclose="1">
${prop('shotcut:audio', 1)}
${prop('shotcut:name', 'A1 - Song')}
    <entry producer="song" in="0" out="${last}"/>
  </playlist>\n` : ''}${prop('shotcut:projectNotes', notes, '  ')}
  <playlist id="main_bin">
${prop('xml_retain', 1)}
${items.map(({clip}) => `    <entry producer="${clip.id}"/>`).join('\n')}${song ? '\n    <entry producer="song"/>' : ''}
  </playlist>
  <producer id="black" in="0" out="${last}">
${prop('mlt_service', 'color')}
${prop('resource', 'black')}
  </producer>
  <playlist id="background">
${prop('shotcut:video', 1)}
${prop('shotcut:name', 'Background')}
    <entry producer="black" in="0" out="${last}"/>
  </playlist>
  <tractor id="main" in="0" out="${last}">
${prop('shotcut', 1)}
    <track producer="background"/>
    <track producer="playlist0"${song ? ' hide="audio"' : ''}/>${song ? '\n    <track producer="playlist1" hide="video"/>' : ''}
  </tractor>
</mlt>
`
}

const keyframe = (value: number) => ({Points: [{co: {X: 1.0, Y: value}, interpolation: 0}]})
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a

function openShotProject({items, width, height, totalFrames, song}: Timeline, target: string) {
    const duration = secondsAt(totalFrames)
    const files: object[] = []
    const clips: object[] = []
    const entry = (id: string, file: string, fileInfo: object, position: number, length: number, layer: number) => {
        files.push({id: `file_${id}`, path: rel(file, target), name: file.split('/').at(-1), duration: length, ...fileInfo})
        clips.push({
            id: `clip_${id}`, title: id, file_id: `file_${id}`,
            reader: {type: 'FFmpegReader', path: rel(file, target)},
            position, start: 0.0, end: length, layer, effects: [], animations: [],
            // libopenshot reads these as enum values: GRAVITY_CENTER, SCALE_FIT
            gravity: 4, scale: 1, rotation: 0.0, shear_x: 0.0, shear_y: 0.0,
            alpha: keyframe(1.0), volume: keyframe(1.0),
        })
    }
    // a rendered file can be longer than the clip (the model renders extra frames): the clip is cut to its own part
    for (const {clip, file, frames} of items) {
        entry(clip.id, file, {
            media_type: 'video', type: 'video', has_video: true, has_audio: true,
            width, height, fps: {num: FPS, den: 1},
        }, secondsAt(clip.frameStart), secondsAt(frames), 1000000)
    }
    if (song) entry('song', song, {media_type: 'audio', type: 'audio', has_video: false, has_audio: true, width: 0, height: 0, fps: {num: 0, den: 1}}, 0.0, duration, 2000000)

    const divisor = gcd(width, height)
    return JSON.stringify({
        id: 'T0',
        fps: {num: FPS, den: 1},
        display_ratio: {num: width / divisor, den: height / divisor},
        pixel_ratio: {num: 1, den: 1},
        width, height,
        sample_rate: 48000, channels: 2, channel_layout: 3,
        settings: {},
        clips, effects: [], files,
        duration,
        scale: 15.0, tick_pixels: 100, playhead_position: 0.0,
        profile: `Custom ${width}x${height} ${FPS} fps`,
        export_settings: null,
        layers: [
            {id: 'L1', label: 'Audio', number: 2000000, y: 0, lock: false},
            {id: 'L2', label: 'Video', number: 1000000, y: 1, lock: false},
        ],
        markers: [], progress: [], history: {undo: [], redo: []},
        // 0.0.0 would make OpenShot run its legacy migrations (it inverts alpha keyframes)
        version: {'openshot-qt': '3.5.1', libopenshot: '0.7.0'},
    }, null, 2) + '\n'
}
