// All video timing is done in whole frames on one grid for the whole song. A clip owns the frames
// [frameStart, frameStart + frames), consecutive clips share their boundary frame, so the clips add
// up to exactly the song's frame count - no rounding drift, whatever the clip lengths are.
export const FPS = 24

export const frameAt = (seconds: number) => Math.round(seconds * FPS)
export const secondsAt = (frame: number) => frame / FPS
