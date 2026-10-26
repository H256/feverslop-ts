// All video timing is done in whole frames on one grid for the whole song. A clip owns the frames
// [frameStart, frameStart + frames), consecutive clips share their boundary frame, so the clips add
// up to exactly the song's frame count - no rounding drift, whatever the clip lengths are.
export const FPS = 24

export const frameAt = (seconds: number) => Math.round(seconds * FPS)
export const secondsAt = (frame: number) => frame / FPS

export const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Context frames (config.contextFrames): the frame batch of the clip before ends this many frames before that clip's end,
 * and these frames are rendered again and cut off with the head. The first frames the model draws after the batch flash
 * brighter (tides slot-014: two frames at 86 against 81 before and 77 after) - they fall into the part that is cut off.
 */
export const CONTEXT_SETTLE = 3

/**
 * The longest a clip may be planned: a continuing clip with context frames is rendered (contextFrames + CONTEXT_SETTLE)
 * frames longer at its head, and that must still fit what the video model can render - or the render runs out of memory.
 * A clip that does not continue would have room for more, but which one continues is only known after the cut.
 */
export const maxClipFor = (maxSec: number, contextFrames: number, continuity: string) =>
    contextFrames > 0 && continuity !== 'never' ? round(maxSec - (contextFrames + CONTEXT_SETTLE) / FPS) : maxSec

// 1:05, or 1:05.3 precise
export function formatTime(seconds: number, precise = false) {
    const secs = precise ? (seconds % 60).toFixed(1).padStart(4, '0') : String(Math.floor(seconds % 60)).padStart(2, '0')
    return `${Math.floor(seconds / 60)}:${secs}`
}

// "00:02.300"
export function formatTimestamp(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`
}
