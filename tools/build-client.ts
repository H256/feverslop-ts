import {join} from 'node:path'
import {cli} from '../lib/cli.ts'
import {log} from '../lib/log.ts'
import {buildClient} from '../lib/editor/client-build.ts'
import {CLIENT_PUBLIC} from '../lib/editor/static.ts'

cli('client:build')
try {
    buildClient(join(import.meta.dir, '..'), CLIENT_PUBLIC)
    log.info('Client installed in lib/editor/public')
} catch (error) {
    log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
}
