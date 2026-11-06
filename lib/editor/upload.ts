import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

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
export async function takePictureUpload(value: unknown): Promise<{ folder: string, file: string, text: (name: string, content: string) => Promise<string>, drop: () => void }> {
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
