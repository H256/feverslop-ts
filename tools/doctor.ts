import {cli} from '../lib/cli.ts'
// What this machine has of what a video needs, and what to do about what it lacks (#828): the settings, the LLM server and its
// model, the ComfyUI servers, ffmpeg and uv, the library, the disk. Read only - asks, renders and writes nothing.
// usage: bun run doctor [--json]
import {doctor, firstFix} from '../lib/doctor.ts'
import {jsonOutput, log, styles} from '../lib/log.ts'
import {listProjects} from '../lib/project-setup.ts'
cli('doctor')

const usage = 'usage: bun run doctor [--json]'
const unknown = Bun.argv.slice(2).filter(arg => arg !== '--json')
if (unknown.length) log.usageError(`Unknown option '${unknown[0]}'`, usage)

const checks = await doctor()
const missing = checks.filter(check => check.state === 'missing')
if (jsonOutput()) {
    log.json({ready: !missing.length, checks})
    process.exit(missing.length ? 1 : 0)
}

const mark = {ready: styles.answer('✔'), missing: styles.warning('✗'), note: styles.muted('·')}
const width = Math.max(...checks.map(check => check.what.length))
for (const check of checks) {
    log.info(`${mark[check.state]} ${check.what.padEnd(width)}  ${check.state === 'ready' ? styles.muted(check.found) : check.found}`)
    if (check.fix) log.info(`  ${' '.repeat(width)}  ${styles.muted('→')} ${check.fix}`)
}
if (missing.length) {
    log.error(`${missing.length} thing(s) a run needs ${missing.length > 1 ? 'are' : 'is'} missing - first: ${firstFix(checks)}`)
    process.exit(1)
}
// ready: what comes next
log.next(listProjects().length ? 'bun run status <project-id>' : 'bun run init')
