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
      const response = await request.get(`${base}/p/${kind}/demo/${area}`)
      expect(response.status()).toBe(200)
      expect(await response.text()).toContain('id="view-list"')
    }
  }
  for (const path of ['/api/nothing', '/p/music/demo/api/nothing', '/p/music/demo/unknown', '/workspace-assets/missing.js', '/p/music/missing/']) {
    expect((await request.get(`${base}${path}`)).status()).toBe(404)
  }
  expect((await request.head(base)).status()).toBe(200)
  expect(origins).toEqual(new Set([base]))
  expect(errors).toEqual([])
})

test('project overview filters, expands takes, paginates and restores URL state', async ({page}) => {
  const projects = Array.from({length: 27}, (_, n) => ({id: `film-${n}`, kind: 'film', title: `Film ${n}`, group: `film/${n}`, clips: 2, rendered: 2, final: 'current', changed: 27 - n, pictures: 0}))
  const music = {id: 'song-2', kind: 'music', title: 'Song newest', group: 'music/song', clips: 2, rendered: 1, final: 'missing', changed: 30, pictures: 0}
  await page.route('**/api/projects', route => route.fulfill({json: {projects: [music, {...music, id: 'song-1', title: 'Song older'}, ...projects]}}))
  await page.route('**/api/status', route => route.fulfill({json: {clips: {stale: 1}, pictures: {stale: 2}, next: {command: 'bun run music', why: 'Render remaining clips'}}}))
  await page.goto(base)
  await expect(page.getByText('Song newest', {exact: true})).toBeVisible()
  await expect(page.getByRole('link').filter({hasText: 'Song newest'})).toHaveAttribute('href', '/p/music/song-2/')
  await expect(page.getByText('Song older', {exact: true})).toHaveCount(0)
  await page.getByRole('button', {name: '1 more take'}).click()
  await expect(page.getByText('Song older', {exact: true})).toBeVisible()
  await page.getByLabel('Project kind').selectOption('film')
  await page.getByRole('button', {name: 'Older', exact: true}).click()
  await expect(page).toHaveURL(/kind=film.*page=2/)
  await expect(page.getByText('Film 26', {exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByText('Film 26', {exact: true})).toBeVisible()
  await page.getByLabel('Find a project').fill('Film 1')
  await expect(page.getByText('Film 1', {exact: true})).toBeVisible()
  await expect(page.getByText('Film 26', {exact: true})).toHaveCount(0)
  await page.getByLabel('Project state').selectOption('unfinished')
  await expect(page.getByText('Nothing fits.')).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Film 1', {exact: true})).toBeVisible()
})

test('library shows details, filters and recovers from a failed request', async ({page}) => {
  let fail = true
  const asset = {id: 'ann', kind: 'character', name: 'Ann', description: '<script>plain description</script>', anchors: 'Red coat', frames: [], usedBy: [{kind: 'film', id: 'demo', role: 'lead'}]}
  await page.route('**/api/library/assets', route => fail ? route.fulfill({status: 503, json: {error: 'Library unavailable'}}) : route.fulfill({json: {dir: '/fixture', assets: [asset]}}))
  await page.goto(`${base}/library`)
  await expect(page.getByRole('link', {name: 'New asset from a picture'})).toHaveAttribute('href', '/library?legacy=1')
  expect(await (await page.request.get(`${base}/library?legacy=1`)).text()).toContain('id="view-list"')
  await expect(page.getByRole('alert')).toContainText('Library unavailable')
  fail = false
  await page.getByRole('button', {name: 'Retry'}).click()
  await page.getByRole('button', {name: 'Ann', exact: false}).click()
  await expect(page.getByRole('heading', {name: 'Ann'})).toBeVisible()
  await expect(page.getByText(asset.description, {exact: true})).toBeVisible()
  await expect(page.getByRole('link', {name: 'demo'})).toHaveAttribute('href', '/p/film/demo/casting')
  await page.getByLabel('Asset kind').selectOption('location')
  await expect(page.getByText('Nothing fits.')).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Ann'})).toHaveCount(0)
  await page.getByLabel('Asset kind').selectOption('all')
  await page.getByLabel('Find an asset').fill('missing')
  await expect(page.getByText('Nothing fits.')).toBeVisible()
})
