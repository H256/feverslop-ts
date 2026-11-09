import {cli} from '../lib/cli.ts'
// Takes a song of the library (lib/song-library.ts) into a project: the audio, the lyrics, the six stems, the analysis, the
// transcript and the timing of every word. The next plan run starts at the story - nothing of the song is done again. A song
// or lyrics file of the project that is not the library's is put away in old/, and what was planned on it goes.
// Without a song id: the songs in the library.
// usage: bun run import-song <project-id> [song-id]
import {loadProjectConfig} from '../lib/config.ts'
import {libraryDir} from '../lib/library.ts'
import {log, styles} from '../lib/log.ts'
import {withProjectLock} from '../lib/lock.ts'
import {projectDir, projectExists} from '../lib/project-setup.ts'
import {ProjectStore} from '../lib/project.ts'
import {importSong, librarySongIds, readLibrarySong} from '../lib/song-library.ts'
cli('import-song')

const usage = 'usage: bun run import-song <project-id> [song-id]'
const [id, songId] = Bun.argv.slice(2).filter(a => !a.startsWith('--'))
if (!id) log.usageError('Which project?', usage)
if (!projectExists(id!)) log.usageError(`No project "${id}" in projects/ - create it first: bun run init ${id}`, usage)
const library = await libraryDir()

if (!songId) {
    const ids = librarySongIds(library)
    if (!ids.length) log.info(styles.muted(`No songs in ${library}/songs yet - put one in: bun run export-song <project-id>`))
    for (const songId of ids) {
        const song = (await readLibrarySong(library, songId))!
        log.info(
            `${styles.name(songId.padEnd(24))} ${song.name}  ${styles.muted(`${Math.round(song.music.durationSec)} s · ${song.lyricsTiming.lines.length} lines, ${song.lyricsTiming.lines.filter(l => l.byHand).length} by hand · ${song.lyricsLanguage}${song.source ? ` · from ${song.source}` : ''}`)}`,
        )
    }
    if (ids.length) log.next(`bun run import-song ${id} <song-id>`)
    process.exit(0)
}

const song = await readLibrarySong(library, songId)
if (!song) log.usageError(`No song "${songId}" in the library - the songs there: ${librarySongIds(library).join(', ') || 'none'}`, usage)
const dir = projectDir(id!)
const config = await loadProjectConfig(dir)
const {putAway, redone, settings} = await withProjectLock(dir, 'import-song', () => importSong(library, song!, new ProjectStore(id!), config))
for (const file of putAway) log.step('Put away', styles.muted(file))
if (settings.length) log.step('config.json', `${settings.join(', ')} ${styles.muted('- as the song was worked out')}`)
if (redone.length) log.step('Planned again', `${redone.join(', ')} ${styles.muted('- they were made for the song before, the next plan run makes them again')}`)
// what config.json says on its own is kept - and said, where it is not how the song was worked out
if (config.lyricsLanguage !== song!.lyricsLanguage)
    log.warn(
        `the song was transcribed in "${song!.lyricsLanguage}", config.json says "${config.lyricsLanguage}" - setting it to "${song!.lyricsLanguage}" later redoes the transcript and the timing; it is only used for the prompts as it is`,
    )
if (!config.alignLyrics) log.warn('config.json has "alignLyrics": false - the plan does not use the timing of the song')
log.success(
    `${id} has the song "${song!.name}": the analysis, ${Object.keys(song!.stems).length} stems and the timing of ${song!.lyricsTiming.lines.length} lines`,
)
log.next(`bun index.ts ${id}`)
