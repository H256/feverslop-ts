import {noProject} from '../lib/usage.ts'
import {cli} from '../lib/cli.ts'
// The runs of a project (#837): the ones waiting in its queue - asked for in the workspace while another went on, started by the
// workspace in order as the project is free - and the ones that ended, with their logs. A queued run can be taken out here.
// usage: bun run runs <project-id> [--film] [--remove=<queued id>] [--clear] [--json]
import {parseArgs} from 'node:util'
import {join} from 'node:path'
import {filmDir, filmExists, filmIds} from '../lib/film/setup.ts'
import {jsonOutput, log, styles} from '../lib/log.ts'
import {listProjects, projectDir, projectExists} from '../lib/project-setup.ts'
import {pastRuns, readQueue, unqueue} from '../lib/run-queue.ts'
cli('runs')

const usage = 'usage: bun run runs <project-id> [--film] [--remove=<queued id>] [--clear] [--json]'
const {
    values: args,
    positionals: [id],
} = (() => {
    try {
        return parseArgs({
            args: Bun.argv.slice(2),
            allowPositionals: true,
            options: {
                film: {type: 'boolean', default: false},
                remove: {type: 'string'},
                clear: {type: 'boolean', default: false},
                json: {type: 'boolean', default: false},
            },
        })
    } catch (e) {
        return log.usageError(e instanceof Error ? e.message : String(e), usage)
    }
})()
if (!id || !(args.film ? filmExists(id) : projectExists(id)))
    log.usageError(args.film ? noProject('film', id, filmIds()) : noProject('project', id, listProjects()), usage)
const dir = args.film ? filmDir(id!) : projectDir(id!)

if (args.remove !== undefined && !unqueue(dir, args.remove)) log.usageError(`no run ${args.remove} in the queue - it may have started already`, usage)
if (args.clear) for (const queued of readQueue(dir)) unqueue(dir, queued.id)

const queue = readQueue(dir)
const past = pastRuns(dir)
if (jsonOutput()) {
    log.json({queue, past})
    process.exit(0)
}

log.section(`QUEUE · ${queue.length} waiting`)
if (!queue.length) log.info(styles.muted('nothing waits - the workspace puts a run here when one is asked for while another goes on'))
for (const queued of queue) log.step(queued.id, `${queued.command} ${styles.muted(`· asked ${new Date(queued.askedAt).toLocaleString()}`)}`)
if (queue.length)
    log.info(
        styles.muted(
            `the workspace starts them in this order as the project is free; take one out: bun run runs ${id}${args.film ? ' --film' : ''} --remove=<id>`,
        ),
    )

log.section(`LAST RUNS · ${past.length}`)
if (!past.length) log.info(styles.muted('none ended yet since runs are kept here'))
for (const run of past) {
    const when = new Date(run.startedAt).toLocaleString()
    const state = run.state === 'finished' ? styles.muted(run.state) : styles.warning(run.state)
    log.step(state, `${run.command} ${styles.muted(`· ${when}${run.log ? ` · ${join('logs', run.log)}` : ''}`)}`)
    if (run.failure) log.info(`   ${styles.warning(run.failure)}`)
}
