// Non-interactive helpers for tools/film-init.ts: where a new film's files go and how they're written -
// films/<id>/{input/*, config.json}.
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import type {FilmConfig} from './config.ts'
import {FILMS_DIR} from './store.ts'

export type FilmSeed = {
    idea?: string // input/idea.txt - a story idea the pipeline develops into a screenplay
    screenplay?: string // input/screenplay.txt - a screenplay in any language, adopted as it is
    style?: string // input/style.txt - visual style
    config?: Partial<FilmConfig>
}

export const filmDir = (id: string) => join(FILMS_DIR, id)
export const filmExists = (id: string) => existsSync(filmDir(id))

const filmsWith = (marker: string) =>
    existsSync(FILMS_DIR)
        ? readdirSync(FILMS_DIR, {withFileTypes: true})
              .filter(d => d.isDirectory() && existsSync(join(FILMS_DIR, d.name, marker)))
              .map(d => d.name)
              .sort()
        : []
/** The films in films/: a folder with its input/ (bun run film:init writes it). */
export const filmIds = () => filmsWith('input')
/** The films planned at least once: their project.json is written. */
export const plannedFilmIds = () => filmsWith('project.json')

/** Writes a new film's input files and config.json (only the keys given - everything else stays default). */
export async function writeFilm(id: string, seed: FilmSeed) {
    if (!seed.idea && !seed.screenplay) throw new Error('a film needs a story idea or a screenplay')
    const dir = filmDir(id)
    const input = (name: string) => join(dir, 'input', name)
    if (seed.screenplay) await Bun.write(input('screenplay.txt'), seed.screenplay)
    else await Bun.write(input('idea.txt'), seed.idea!)
    if (seed.style) await Bun.write(input('style.txt'), seed.style)
    if (seed.config && Object.keys(seed.config).length) await Bun.write(join(dir, 'config.json'), JSON.stringify(seed.config, null, 2))
    return dir
}
