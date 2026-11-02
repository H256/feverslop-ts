import {join} from "node:path";
import {archiveFiles} from "../archive.ts";
import {boundaryFrameAsset} from "../compose.ts";

/** Puts a rendered clip - the video and its first and last frame - away in old/attempts/, so that it can be rendered again and the old one is still there. */
export function archiveClip(projectDir: string, clipId: string, label: string) {
    return archiveFiles(projectDir, `${clipId}-${label}`, [join('videos', `${clipId}.mp4`), join('videos', `${clipId}.mp4.json`), boundaryFrameAsset(clipId, 'lf'), boundaryFrameAsset(clipId, 'ff')])
}
