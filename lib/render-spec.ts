import {join} from "node:path";
import {fileFingerprint, fingerprint, recordedFingerprint} from "./provenance.ts";

// What one rendered file is made from, in one place per kind of file. The id of a spec is the fingerprint the sidecar of
// the file records (lib/provenance.ts), the one a queued job is bound to (.pending.json) and the one the final video
// compares - so what counts as "the same request" is decided here and nowhere else.
// The seed is deliberately not part of it: another seed is the same request, rendered again.

export type RenderSpec = {
    kind: 'picture' | 'anchor' | 'sequence' | 'sheet' | 'song' | 'clip' | 'interpolation',
    id: string,                     // what it is called: the character, the place, the clip
    parts: unknown[],               // the inputs that decide the id, in a fixed order
    fixed?: string,                 // a file the user put in place: its content is its id
}

export const specId = (spec: RenderSpec) => spec.fixed ?? fingerprint(...spec.parts)

type ImageConfig = { imageWorkflow: string, imageResolution: unknown }
type VideoConfig = { videoWorkflow: string, videoResolution: unknown }

/** A reference picture: what its prompt, workflow and size say. */
export const pictureSpec = (picture: { id: string, prompt: string }, config: ImageConfig): RenderSpec =>
    ({kind: 'picture', id: picture.id, parts: [picture.prompt, config.imageWorkflow, config.imageResolution]})

/** The anchor of a sequence sheet: like a picture - or, when the user replaced it (tools/replace-character), the file itself. */
export const anchorSpec = (picture: { id: string, prompt: string }, config: ImageConfig, userFile?: string): RenderSpec =>
    userFile ? {kind: 'anchor', id: picture.id, parts: [], fixed: fileFingerprint(userFile)} : {...pictureSpec(picture, config), kind: 'anchor'}

/** The turnaround video and the sheet made of it: the anchor, the prompt of the sequence and its workflow. */
export const sequenceSpec = (kind: 'sequence' | 'sheet', id: string, anchor: RenderSpec, sequencePrompt: string, sequenceWorkflow: string): RenderSpec =>
    ({kind, id, parts: [specId(anchor), sequencePrompt, sequenceWorkflow]})

export const songSpec = (brief: { style: string, lyrics: string }, config: { songWorkflow: string, songDuration: number }): RenderSpec =>
    ({kind: 'song', id: 'song', parts: [brief.style, brief.lyrics, config.songWorkflow, config.songDuration]})

/** The file of the clip a clip goes on from: what that one was made from is part of this one. */
const predecessorId = (projectDir: string, startsFrom: string | undefined) =>
    startsFrom ? recordedFingerprint(join(projectDir, `videos/${startsFrom}.mp4`)) ?? '' : ''

/**
 * A music-video clip: its prompt and length, the workflow, the content of the pictures it is given, the spans of its
 * audio tracks and - for a clip that goes on from another - what that one was made from, so rendering a clip again makes
 * its successors stale.
 */
export function clipSpec(
    clip: { id: string, prompt: string, frames: number, startsFrom?: string, assets: { pictures: { kind: string, file: string }[], audio: { stem?: string, songStart: number, songEnd: number }[] } },
    projectDir: string, config: VideoConfig,
): RenderSpec {
    return {
        kind: 'clip', id: clip.id,
        parts: [
            clip.prompt, clip.frames, config.videoWorkflow, config.videoResolution,
            clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => fileFingerprint(join(projectDir, p.file))),
            clip.assets.audio.map(a => [a.stem, a.songStart, a.songEnd]),
            predecessorId(projectDir, clip.startsFrom),
        ],
    }
}

/** A film clip: its prompt hash (prompt and length), workflow, size, whether the start frame is pinned, pictures and predecessor. */
export function filmClipSpec(
    clip: { id: string, promptHash: string, startsFrom?: string, assets: { pictures: { kind: string, file: string }[] } },
    projectDir: string, config: VideoConfig & { pinStartFrame?: boolean },
): RenderSpec {
    return {
        kind: 'clip', id: clip.id,
        parts: [
            clip.promptHash, config.videoWorkflow, config.videoResolution, config.pinStartFrame === true,
            clip.assets.pictures.filter(p => p.kind !== 'frame').map(p => fileFingerprint(join(projectDir, p.file))),
            predecessorId(projectDir, clip.startsFrom),
        ],
    }
}
