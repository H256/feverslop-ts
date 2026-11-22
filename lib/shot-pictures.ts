import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {frameAt} from './frames.ts'

// The start pictures a clip is rendered with (#1187): each shot whose picture is in startframes/ (made by --render=startframes,
// lib/render/startframes.ts) has it locked at its first frame. A picture that is there is the one taken - redo it to change it,
// delete it to render the shot from the words alone. Its own module: the render spec and the renderer both read it.

export const startFrameFile = (clip: string, shot: number) => `startframes/${clip}-shot${shot + 1}.png`

export type ShotPicture = {shot: number; file: string; at: number}

/**
 * The start pictures of a clip, each at its shot's first frame of the clip. A clip that goes on from the one before starts on
 * that one's last frame: its first shot keeps that, not a picture of its own.
 */
export function shotPictures(clip: {id: string; startsFrom?: string; shots: {at: number}[]}, projectDir: string): ShotPicture[] {
    return clip.shots.flatMap((shot, n) => {
        const file = startFrameFile(clip.id, n)
        if (n === 0 && clip.startsFrom) return []
        return existsSync(join(projectDir, file)) ? [{shot: n, file, at: frameAt(shot.at)}] : []
    })
}
