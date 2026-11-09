import {cli} from '../lib/cli.ts'
// Puts a project's song into the library (lib/song-library.ts): the audio, the lyrics, the six stems and all that is worked
// out from them - the analysis, the transcript and the timing of every word, with what was placed by hand on the Timing page.
// Another project takes it with import-song and starts at the story. Nothing is rendered; a song in the library is never
// overwritten.
// usage: bun run export-song <project-id> [--as=<song id>] [--name=<name>]
import {join} from 'node:path'
import {loadProjectConfig} from '../lib/config.ts'
import {libraryDir, libraryIdPattern} from '../lib/library.ts'
import {log} from '../lib/log.ts'
import {projectDir, projectExists} from '../lib/project-setup.ts'
import type {Project} from '../lib/project.ts'
import {exportSong, songFolder} from '../lib/song-library.ts'
cli('export-song')

const usage = 'usage: bun run export-song <project-id> [--as=<song id>] [--name=<name>]'
const args = Bun.argv.slice(2)
const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const [id] = args.filter(a => !a.startsWith('--'))
if (!id) log.usageError('Which project?', usage)
if (!projectExists(id!)) log.usageError(`No project "${id}" in projects/`, usage)
const dir = projectDir(id!)
const songId = option('as') ?? id!
if (!libraryIdPattern.test(songId)) log.usageError(`"${songId}" is no usable song id - lowercase letters, digits and dashes`, usage)

const file = join(dir, 'project.json')
const data: Project = await Bun.file(file)
    .json()
    .catch(() => ({}))
const config = await loadProjectConfig(dir)
const library = await libraryDir()
const {song, copied} = await exportSong(library, dir, data, {id: songId, name: option('name') ?? songId, lyricsLanguage: config.lyricsLanguage, source: id})
const byHand = song.lyricsTiming.lines.filter(l => l.byHand).length
const folder = join(library, songFolder(song.id))
log.success(
    `"${song.name}" is in the library as song "${song.id}" (${copied} files, ${Object.keys(song.stems).length} stems, ${song.lyricsTiming.lines.length} lines, ${byHand} placed by hand): ${folder}`,
)
log.output(folder)
log.next(`bun run import-song <project-id> ${song.id}`)
