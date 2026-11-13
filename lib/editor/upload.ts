import {mkdtempSync, readdirSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {basename, dirname, join, resolve} from 'node:path'

// A picture sent from the page: only as large as a picture is, only what its first bytes say is a PNG, a JPEG or a WebP - never
// what its name or its type header say - written under a name of the server's own into a folder of its own, which goes again
// when the run it is for has ended (RunControl). ffmpeg reading it as a picture is the second check (lib/own-picture.ts).

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

/** What the first bytes say the file is: a PNG, a JPEG or a WebP - nothing else is taken. */
export function pictureType(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | undefined {
    const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value)
    if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
    if (at(0, 0xff, 0xd8, 0xff)) return 'jpg'
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
    return undefined
}

/** A refused upload: what the page shows. */
export class UploadRefused extends Error {}

/** The size the request says, checked before anything of it is read - a request that says none is read only up to the limit (the File's size). */
export function checkUploadSize(request: Request) {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > UPLOAD_MAX_BYTES + 64 * 1024) throw new UploadRefused(`the picture is too large - at most ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`)
}

/**
 * The picture of a form field, put into a folder of its own: its path, and the folder that goes again with the run. Texts sent
 * with it go into the same folder (`text`): a run takes them as files, never as a line of shell.
 */
export async function takePictureUpload(
    value: unknown,
): Promise<{folder: string; file: string; text: (name: string, content: string) => Promise<string>; drop: () => void}> {
    if (!(value instanceof File)) throw new UploadRefused('no picture sent')
    if (value.size === 0) throw new UploadRefused('the picture is empty')
    if (value.size > UPLOAD_MAX_BYTES) throw new UploadRefused(`the picture is too large - at most ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`)
    const type = pictureType(new Uint8Array(await value.arrayBuffer()))
    if (!type) throw new UploadRefused('not a picture: a PNG, a JPEG or a WebP is taken')
    const folder = mkdtempSync(join(tmpdir(), 'workspace-upload-'))
    const drop = () => rmSync(folder, {recursive: true, force: true})
    try {
        const file = join(folder, `picture.${type}`)
        await Bun.write(file, value)
        const text = async (name: string, content: string) => {
            const path = join(folder, `${name}.txt`)
            await Bun.write(path, content)
            return path
        }
        return {folder, file, text, drop}
    } catch (e) {
        drop()
        throw e
    }
}

// A song chosen in the start page's form (#939): the browser never says where a file is on the machine (a "fakepath"), so the file
// itself is sent. Like a picture: only what its first bytes say is a WAV, a FLAC or an MP3, under a name of the server's own, in a
// folder of its own - `bun run init --song=<that file>` copies it into the project, and the folder goes again.

/** The largest song taken - a 10-minute WAV in 24 bit at 48 kHz is about 170 MB. */
export const SONG_MAX_BYTES = 400 * 1024 * 1024
const SONG_FOLDER = 'workspace-song-'

/** What the first bytes say the song is: a WAV, a FLAC or an MP3 (with an ID3 tag or a frame header) - nothing else is taken. */
export function songType(bytes: Uint8Array): 'wav' | 'flac' | 'mp3' | undefined {
    const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value)
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return 'wav'
    if (at(0, 0x66, 0x4c, 0x61, 0x43)) return 'flac'
    if (at(0, 0x49, 0x44, 0x33)) return 'mp3'
    // an MPEG audio frame: eleven bits of sync, layer III
    if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe6) === 0xe2) return 'mp3'
    return undefined
}

/** How long a song sent for a form that was never sent on is kept: the next song sent clears older ones away. */
const SONG_KEPT_MS = 24 * 60 * 60 * 1000

/** Songs sent for a form that was closed instead of created: gone after a day, when the next one comes. */
export function sweepSongUploads(now = Date.now()) {
    for (const name of readdirSync(tmpdir())) {
        if (!name.startsWith(SONG_FOLDER)) continue
        const folder = join(tmpdir(), name)
        try {
            if (now - statSync(folder).mtimeMs > SONG_KEPT_MS) rmSync(folder, {recursive: true, force: true})
        } catch {
            // gone already, or in use: the next sweep sees it
        }
    }
}

/** The song of a form field, put into a folder of its own: its path, the name it had, and how to drop it again. */
export async function takeSongUpload(value: unknown): Promise<{file: string; name: string; bytes: number}> {
    sweepSongUploads()
    if (!(value instanceof File)) throw new UploadRefused('no song sent')
    if (value.size === 0) throw new UploadRefused('the song file is empty')
    if (value.size > SONG_MAX_BYTES) throw new UploadRefused(`the song is too large - at most ${SONG_MAX_BYTES / 1024 / 1024} MB`)
    // its first bytes only - a song is too large to be read whole for that
    const reader = value.stream().getReader()
    const first = await reader.read()
    await reader.cancel()
    const type = songType(first.value ?? new Uint8Array())
    if (!type) throw new UploadRefused('not a song: a WAV, a FLAC or an MP3 is taken')
    const folder = mkdtempSync(join(tmpdir(), SONG_FOLDER))
    try {
        const file = join(folder, `song.${type}`)
        await Bun.write(file, value)
        return {file, name: value.name.replace(/[\/]/g, '').slice(0, 200), bytes: value.size}
    } catch (e) {
        rmSync(folder, {recursive: true, force: true})
        throw e
    }
}

/** Whether a path is a song taken by takeSongUpload - its folder goes once the project has it. */
export function uploadedSongFolder(path: string): string | undefined {
    const folder = dirname(resolve(path))
    return dirname(folder) === resolve(tmpdir()) && basename(folder).startsWith(SONG_FOLDER) ? folder : undefined
}
