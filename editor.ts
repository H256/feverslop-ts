import {cli} from './lib/cli.ts';
// The workspace: a page over all projects and films - the whole video on one timeline, every clip playable in place with its prompt,
// shots and references next to it, renders started and followed from there, the library and the casting. See issue #152.
// usage: bun editor.ts [project-id] [--film] [--port=4173]   (no id: the start page. --film: a film in films/)
import {parseArgs} from "node:util";
import {startEditor} from "./lib/editor/server.ts";
import {listProjects, projectExists} from "./lib/project-setup.ts";
import {log, styles} from "./lib/log.ts";
import {filmExists, filmIds} from "./lib/film/setup.ts";
import {FILMS_DIR} from "./lib/film/store.ts";
import {buildClient, clientBuildState} from "./lib/editor/client-build.ts";
import {CLIENT_PUBLIC} from "./lib/editor/static.ts";
cli('editor')

const usage = 'usage: bun editor.ts [project-id] [--film] [--port=4173]'
const {values: args, positionals} = (() => {
    try {
        return parseArgs({args: Bun.argv.slice(2), allowPositionals: true, options: {film: {type: 'boolean', default: false}, port: {type: 'string', default: '4173'}}})
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
const id = positionals[0]
const port = Number(args.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) log.usageError(`--port must be a port number, got "${args.port}"`, usage)

if (id && args.film && !filmExists(id)) log.usageError(`No film "${id}" in ${FILMS_DIR}/ - the films here are: ${filmIds().join(', ')}`, usage)
if (id && !args.film && !projectExists(id)) log.usageError(`No project "${id}" in projects/ - the projects here are: ${listProjects().slice(0, 12).join(', ')}`, usage)

// the page is a build of client/: made again when its sources changed since, so a pull never shows an older page
const client = clientBuildState(import.meta.dir, CLIENT_PUBLIC)
if (client === 'missing' || client === 'stale') {
    log.step('Build', client === 'missing' ? 'the workspace page is not built yet' : 'the workspace page changed since its last build')
    try {
        buildClient(import.meta.dir, CLIENT_PUBLIC)
    } catch (e) {
        log.error(e instanceof Error ? e.message : String(e))
        process.exit(1)
    }
}

const server = startEditor(port)
const path = id ? `p/${args.film ? 'film' : 'music'}/${id}/` : ''
log.step('Open', styles.name(`http://127.0.0.1:${server.port}/${path}`))
log.step('Stop', styles.muted('Ctrl+C'))
