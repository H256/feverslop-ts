import {cli} from './lib/cli.ts';
// The workspace: a page that shows a whole music video or film on one timeline, every clip playable in place with its prompt,
// shots and references next to it. Read-only for now - no lock, no LLM, no ComfyUI. See issue #152.
// usage: bun editor.ts <project-id> [--film] [--port=4173]   (--film: a film in films/)
import {parseArgs} from "node:util";
import {startEditor} from "./lib/editor/server.ts";
import {listProjects, projectDir, projectExists} from "./lib/project-setup.ts";
import {log, styles} from "./lib/log.ts";
import {filmDir, filmExists} from "./lib/film/setup.ts";
import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {FILMS_DIR} from "./lib/film/store.ts";
cli('editor')

const usage = 'usage: bun editor.ts <project-id> [--film] [--port=4173]'
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

if (args.film) {
    if (!id || !filmExists(id)) {
        const films = existsSync(FILMS_DIR) ? readdirSync(FILMS_DIR, {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join(FILMS_DIR, d.name, 'input'))).map(d => d.name) : []
        log.usageError(`${id ? `No film "${id}" in ${FILMS_DIR}/` : 'Which film?'} - the films here are: ${films.join(', ')}`, usage)
    }
} else if (!id || !projectExists(id)) {
    log.usageError(`${id ? `No project "${id}" in projects/` : 'Which project?'} - the projects here are: ${listProjects().slice(0, 12).join(', ')}`, usage)
}

const server = startEditor({id: id!, dir: args.film ? filmDir(id!) : projectDir(id!), kind: args.film ? 'film' : 'music'}, port)
log.step('Open', styles.name(`http://127.0.0.1:${server.port}/`))
log.step('Stop', styles.muted('Ctrl+C'))
