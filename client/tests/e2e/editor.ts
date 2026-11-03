import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The real editor (bun editor.ts) with the installed Vue build, in an empty temporary workspace with one music video and one film
 * folder named demo. Nothing of the user's: no settings, no projects, no running process is touched.
 */
export async function startEditor() {
  const cwd = mkdtempSync(join(tmpdir(), 'workspace-vue-browser-'))
  mkdirSync(join(cwd, 'projects', 'demo'), {recursive: true})
  mkdirSync(join(cwd, 'films', 'demo'), {recursive: true})
  const reservation = createServer()
  await new Promise<void>((accept, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', accept) })
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((accept, reject) => reservation.close(error => error ? reject(error) : accept()))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FEVERSLOP_|COMFY$|NODE_OPTIONS$|BUN_OPTIONS$)/i.test(key)))
  Object.assign(env, {FEVERSLOP_SETTINGS: join(cwd, 'missing.json'), NO_COLOR: '1'})
  const child: ChildProcess = spawn('bun', [resolve(root, 'editor.ts'), `--port=${address.port}`], {cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true})
  const exited = new Promise<void>(accept => child.once('close', () => accept()))
  let output = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const base = await new Promise<string>((accept, reject) => {
      timer = setTimeout(() => reject(new Error(`Editor startup timeout: ${output}`)), 10_000)
      child.once('error', reject)
      child.once('exit', code => reject(new Error(`Editor exited (${code}): ${output}`)))
      child.stderr!.on('data', chunk => { output += String(chunk) })
      child.stdout!.on('data', chunk => {
        output += String(chunk)
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
        if (url) accept(url)
      })
    })
    return {
      base,
      stop: async () => {
        child.kill()
        await exited
        rmSync(cwd, {recursive: true, force: true})
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
