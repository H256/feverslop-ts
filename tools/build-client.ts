import {join} from 'node:path';
import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
import {installClientBuild} from '../lib/editor/client-build.ts';

cli('client:build')
const root = join(import.meta.dir, '..')
const result = Bun.spawnSync([process.execPath, 'run', 'build'], {cwd: join(root, 'client'), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit'})
if (result.exitCode !== 0) process.exit(result.exitCode || 1)
try {
    installClientBuild(join(root, 'client/dist'), join(root, 'lib/editor/public'))
    log.info('Client installed in lib/editor/public')
} catch (error) {
    log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
}
