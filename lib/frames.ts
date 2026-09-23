// All video timing is done in whole frames on one grid for the whole song. A clip owns the frames
// [frameStart, frameStart + frames), consecutive clips share their boundary frame, so the clips add
// up to exactly the song's frame count - no rounding drift, whatever the clip lengths are.
export const FPS = 24

export const frameAt = (seconds: number) => Math.round(seconds * FPS)
export const secondsAt = (frame: number) => frame / FPS

export const round = (n: number) => Math.round(n * 1000) / 1000

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
