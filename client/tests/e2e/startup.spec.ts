import {test, expect} from '@playwright/test'
import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'

const root = fileURLToPath(new URL('../../..', import.meta.url))
let cwd: string, base: string, child: ChildProcess | undefined
let exited: Promise<void> | undefined

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'workspace-vue-browser-'))
  mkdirSync(join(cwd, 'projects', 'demo'), {recursive: true})
  mkdirSync(join(cwd, 'films', 'demo'), {recursive: true})
  const reservation = createServer()
  await new Promise<void>((accept, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', accept) })
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  await new Promise<void>((accept, reject) => reservation.close(error => error ? reject(error) : accept()))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FEVERSLOP_|COMFY$|NODE_OPTIONS$|BUN_OPTIONS$)/i.test(key)))
  Object.assign(env, {FEVERSLOP_EDITOR_UI: 'vue', FEVERSLOP_SETTINGS: join(cwd, 'missing.json'), NO_COLOR: '1'})
  child = spawn('bun', [resolve(root, 'editor.ts'), `--port=${address.port}`], {cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true})
  exited = new Promise(accept => child!.once('close', () => accept()))
  let output = ''
  let timer: ReturnType<typeof setTimeout>
  try {
    base = await new Promise<string>((accept, reject) => {
      timer = setTimeout(() => reject(new Error(`Editor startup timeout: ${output}`)), 10_000)
      child!.once('error', reject)
      child!.once('exit', code => reject(new Error(`Editor exited (${code}): ${output}`)))
      child!.stderr!.on('data', chunk => { output += String(chunk) })
      child!.stdout!.on('data', chunk => {
        output += String(chunk)
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
        if (url) accept(url)
      })
    })
  } finally { clearTimeout(timer!) }
})

test.afterAll(async () => {
  child?.kill()
  if (exited) await exited
  if (cwd) rmSync(cwd, {recursive: true, force: true})
})

test('production Vue assets boot through Bun, with navigation and direct project routes', async ({page, request}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const origins = new Set<string>()
  page.on('request', request => origins.add(new URL(request.url()).origin))
  await page.goto(base)
  await expect(page.getByRole('heading', {name: 'Projects', exact: true})).toBeVisible()
  await page.getByRole('link', {name: 'Library', exact: true}).click()
  await expect(page).toHaveURL(`${base}/library`)
  await expect(page.getByRole('heading', {name: 'Library', exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', {name: 'Library', exact: true})).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', {name: 'Projects', exact: true})).toBeVisible()
  for (const kind of ['music', 'film']) {
    for (const area of ['', 'story', 'casting', 'look', 'references', 'singers', 'timing']) {
      const response = await page.goto(`${base}/p/${kind}/demo/${area}`)
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', {name: 'Project', exact: true})).toBeVisible()
    }
  }
  for (const path of ['/api/nothing', '/p/music/demo/api/nothing', '/p/music/demo/unknown', '/workspace-assets/missing.js', '/p/music/missing/']) {
    expect((await request.get(`${base}${path}`)).status()).toBe(404)
  }
  expect((await request.head(base)).status()).toBe(200)
  expect(origins).toEqual(new Set([base]))
  expect(errors).toEqual([])
})
