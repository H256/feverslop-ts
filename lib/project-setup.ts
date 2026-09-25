// Non-interactive helpers shared by tools/init.ts (the wizard) and tools/example.ts (random example projects):
// where a new project's files go and how they're written - projects/<id>/{input/*, config.json}.
import {existsSync} from "node:fs";
import {join} from "node:path";
import type {ProjectConfig} from "./config.ts";

export type ProjectSeed = {
    songFile?: string // path to an existing audio file, copied in as input/song.wav or input/song.mp3
    idea?: string      // input/idea.txt - a song idea for --render=song to write lyrics + generate audio from
    lyrics?: string    // input/lyrics.txt
    storyIdea?: string // input/story-idea.txt
    style?: string     // input/style.txt - visual style
    musicStyle?: string// input/music-style.txt
    config?: Partial<ProjectConfig>
}

export function projectDir(id: string) {
    return join('projects', id)
}

export function projectExists(id: string) {
    return existsSync(projectDir(id))
}

// a project id is a directory name and part of the ComfyUI client id - keep it filesystem- and URL-safe
export function validProjectId(id: string) {
    return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(id)
}

/** Writes a new project's input files and config.json (only the keys given - everything else stays default). */
export async function writeProject(id: string, seed: ProjectSeed) {
    const dir = projectDir(id)
    const input = (name: string) => join(dir, 'input', name)
    if (seed.songFile) {
        const ext = seed.songFile.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav'
        await Bun.write(input(`song.${ext}`), Bun.file(seed.songFile))
    }
    if (seed.idea) await Bun.write(input('idea.txt'), seed.idea)
    if (seed.lyrics) await Bun.write(input('lyrics.txt'), seed.lyrics)
    if (seed.storyIdea) await Bun.write(input('story-idea.txt'), seed.storyIdea)
    if (seed.style) await Bun.write(input('style.txt'), seed.style)
    if (seed.musicStyle) await Bun.write(input('music-style.txt'), seed.musicStyle)
    if (seed.config && Object.keys(seed.config).length) {
        await Bun.write(join(dir, 'config.json'), JSON.stringify(seed.config, null, 2))
    }
    return dir
}
