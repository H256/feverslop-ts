// The library at a glance - its characters, places and songs, and the projects that use them - and one of them renamed,
// described anew or put away (#835). The Library page starts the same commands.
// usage: bun run library [--json]
//        bun run library rename <character|location|song> <id> <name>
//        bun run library describe <character|location> <id> <text>
//        bun run library remove <character|location|song> <id>
import {cli} from '../lib/cli.ts'
import {LIBRARY_KINDS, type LibraryKind, type LibraryUse, listLibrary} from '../lib/library-admin.ts'
import {changeLibrary} from '../lib/editor/library.ts'
import {libraryDir} from '../lib/library.ts'
import {log, styles} from '../lib/log.ts'
cli('library')

const usage =
    'usage: bun run library [--json] | rename <character|location|song> <id> <name> | describe <character|location> <id> <text> | remove <character|location|song> <id>'
const args = Bun.argv.slice(2)
const json = args.includes('--json')
const [action, kind, id, ...words] = args.filter(a => !a.startsWith('--'))
const dir = await libraryDir()

const users = (used: LibraryUse[]) =>
    used.length ? used.map(u => `${u.kind === 'film' ? 'film ' : ''}${u.id}${u.role ? ` (${u.role})` : ''}`).join(', ') : 'not used yet'

if (!action) {
    const listing = await listLibrary(dir)
    if (json) {
        console.log(JSON.stringify(listing, null, 2))
        process.exit(0)
    }
    log.info(styles.muted(dir))
    for (const [title, items] of [
        ['Characters', listing.characters],
        ['Places', listing.locations],
    ] as const) {
        log.section(`${title} (${items.length})`)
        for (const item of items) log.info(`${styles.name(item.id.padEnd(24))} ${item.name}  ${styles.muted(users(item.usedBy))}`)
    }
    log.section(`Songs (${listing.songs.length})`)
    for (const song of listing.songs)
        log.info(
            `${styles.name(song.id.padEnd(24))} ${song.name}  ${styles.muted(
                `${song.seconds ? `${Math.round(song.seconds)} s · ` : ''}${song.stems} stems · ${song.lines} lines, ${song.byHand} by hand · ${users(song.usedBy)}`,
            )}`,
        )
    if (!listing.characters.length && !listing.locations.length && !listing.songs.length)
        log.info(styles.muted('The library is empty - bun run create-asset, bun run export-asset or bun run export-song put something in.'))
    process.exit(0)
}

if (!['rename', 'describe', 'remove'].includes(action)) log.usageError(`no such action "${action}" - rename, describe or remove`, usage)
if (!kind || !LIBRARY_KINDS.includes(kind as LibraryKind)) log.usageError(`a kind first: character, location or song - got "${kind ?? ''}"`, usage)
if (!id) log.usageError(`which ${kind}: its id`, usage)
const entryKind = kind as LibraryKind

try {
    if (action === 'rename') {
        if (!words.length) log.usageError('the new name after the id', usage)
        // the same function as the Library page's change (#835): one place for what a change does
        const {from, to} = (await changeLibrary({action: 'rename', kind: entryKind, id: id!, name: words.join(' ')})).renamed!
        log.success(`${kind} "${id}": ${from} is now ${to}. Its id stays - the projects name it by that.`)
    } else if (action === 'describe') {
        if (entryKind === 'song') log.usageError('a song has no description - rename it instead', usage)
        if (!words.length) log.usageError('the new description after the id', usage)
        await changeLibrary({action: 'describe', kind: entryKind as 'character' | 'location', id: id!, description: words.join(' ')})
        log.success(`${kind} "${id}" is described anew. A project that took it keeps its copy until it takes it again.`)
    } else {
        const to = (await changeLibrary({action: 'remove', kind: entryKind, id: id!})).putAway!
        log.success(`${kind} "${id}" is out of the library - put away, not deleted: ${to}`)
        log.output(to)
    }
} catch (e) {
    log.fatal(e instanceof Error ? e.message : String(e))
}
