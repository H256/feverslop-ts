import {test, expect} from '@playwright/test'
import {existsSync, readFileSync} from 'node:fs'
import {startEditor} from './editor'

const {version} = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {version: string}

let editor: Awaited<ReturnType<typeof startEditor>>
let base: string
test.beforeAll(async () => {
  editor = await startEditor()
  base = editor.base
})
test.afterAll(async () => {
  await editor?.stop()
})

test('production Vue assets boot through Bun, with navigation and direct project routes', async ({page, request}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const origins = new Set<string>()
  page.on('request', request => origins.add(new URL(request.url()).origin))
  await page.goto(base)
  await expect(page.getByRole('heading', {name: 'Projects', exact: true})).toBeVisible()
  // the start page says where you are in its crumbs, not in a heading of the top bar (#776)
  await expect(page).toHaveTitle('Workspace')
  // the release the build belongs to, from the repository's package.json
  await expect(page.locator('.top .release')).toHaveText('v' + version)
  // the logo: the mark in the top bar and the icon of the tab
  await expect(page.locator('.top .mark img')).toHaveJSProperty('naturalWidth', 64)
  const icon = await request.get(base + (await page.locator('link[rel=icon]').getAttribute('href'))!)
  expect(icon.headers()['content-type']).toBe('image/png')
  await page.getByRole('navigation', {name: 'Workspace'}).getByRole('link', {name: 'Library', exact: true}).click()
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
      expect(await response.text()).toContain('<div id="app">')
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
  const projects = Array.from({length: 27}, (_, n) => ({
    id: `film-${n}`,
    kind: 'film',
    title: `Film ${n}`,
    group: `film/${n}`,
    clips: 2,
    rendered: 2,
    final: 'current',
    changed: 27 - n,
    pictures: 0,
  }))
  const music = {id: 'song-2', kind: 'music', title: 'Song newest', group: 'music/song', clips: 2, rendered: 1, final: 'missing', changed: 30, pictures: 0}
  await page.route('**/api/projects', route => route.fulfill({json: {projects: [music, {...music, id: 'song-1', title: 'Song older'}, ...projects]}}))
  await page.route('**/api/status', route =>
    route.fulfill({json: {clips: {stale: 1}, pictures: {stale: 2}, next: {command: 'bun run music', why: 'Render remaining clips'}}}),
  )
  await page.goto(base)
  await expect(page.getByText('Song newest', {exact: true})).toBeVisible()
  await expect(page.getByRole('link').filter({hasText: 'Song newest'})).toHaveAttribute('href', '/p/music/song-2/')
  await expect(page.getByText('Song older', {exact: true})).toHaveCount(0)
  await expect(page.getByText('Next: Render remaining clips').first()).toBeVisible()
  await page.getByRole('button', {name: '1 more take'}).click()
  await expect(page.getByText('Song older', {exact: true})).toBeVisible()
  await page.getByRole('group', {name: 'Project kind'}).getByRole('button', {name: 'Films'}).click()
  await page.getByRole('button', {name: 'Older ›'}).click()
  await expect(page).toHaveURL(/kind=film.*page=2/)
  await expect(page.getByText('Film 26', {exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByText('Film 26', {exact: true})).toBeVisible()
  await page.getByLabel('Find a project').fill('Film 1')
  await expect(page.getByText('Film 1', {exact: true})).toBeVisible()
  await expect(page.getByText('Film 26', {exact: true})).toHaveCount(0)
  await page.getByRole('group', {name: 'Project state'}).getByRole('button', {name: 'Unfinished'}).click()
  await expect(page.getByText('Nothing fits.')).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Film 1', {exact: true})).toBeVisible()
})

test('library shows details, filters, recovers from a failed request and asks before making an asset', async ({page}) => {
  let fail = true
  const posts: string[] = []
  const asset = {
    id: 'ann',
    kind: 'character',
    name: 'Ann',
    description: '<script>plain description</script>',
    anchors: 'Red coat',
    frames: [],
    usedBy: [{kind: 'film', id: 'demo', role: 'lead'}],
  }
  await page.route('**/api/library/assets', route =>
    fail ? route.fulfill({status: 503, json: {error: 'Library unavailable'}}) : route.fulfill({json: {dir: '/fixture', assets: [asset]}}),
  )
  await page.route('**/api/library/create', route => {
    posts.push(route.request().url())
    return route.fulfill({json: {run: {source: 'here', command: 'bun tools/create-asset.ts', pid: 1, startedAt: '', running: true}}})
  })
  await page.goto(`${base}/library`)
  await expect(page.getByRole('alert')).toContainText('Library unavailable')
  fail = false
  await page.getByRole('button', {name: 'Retry'}).click()
  await page.getByRole('button', {name: /^Ann/}).click()
  await expect(page.getByRole('heading', {name: 'Ann'})).toBeVisible()
  await expect(page.getByText(asset.description, {exact: true})).toBeVisible()
  await expect(page.getByRole('link', {name: 'demo'})).toHaveAttribute('href', '/p/film/demo/casting')
  await page.getByRole('group', {name: 'Asset kind'}).getByRole('button', {name: 'Places'}).click()
  await expect(page.getByText('Nothing fits.')).toBeVisible()
  await page.getByRole('group', {name: 'Asset kind'}).getByRole('button', {name: 'All'}).click()
  await page.getByLabel('Find an asset').fill('missing')
  await expect(page.getByText('Nothing fits.')).toBeVisible()
  await page.getByRole('button', {name: 'New asset from a picture'}).click()
  await expect(page.getByRole('dialog', {name: 'New asset from a picture'})).toBeVisible()
  await page.getByLabel('Library id').fill('kael')
  await page.getByRole('button', {name: 'Cancel'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(posts).toEqual([])
})

// #831: an empty workspace shows the first steps; a music video and a film are made by their forms, each the options of its command
test('first run: the steps, no red server, and the new-project forms send what the commands take', async ({page}) => {
  await page.route('**/api/projects', route => route.fulfill({json: {projects: []}}))
  await page.route('**/api/servers', route =>
    route.fulfill({json: {servers: [{name: 'localhost:8188', reachable: false, running: 0, pending: 0, unset: true}]}}),
  )
  await page.route('**/api/library/assets', route => route.fulfill({json: {dir: 'library', assets: [], songs: []}}))
  const asked: {url: string; body: unknown}[] = []
  for (const kind of ['projects', 'films'])
    await page.route(`**/api/${kind}/new`, async route => {
      asked.push({url: route.request().url(), body: route.request().postDataJSON() as unknown})
      await route.fulfill({json: {id: (route.request().postDataJSON() as {id: string}).id}})
    })
  await page.goto(base)
  await expect(page.getByText('No projects here yet.')).toBeVisible()
  // the default server, nobody set one up: a way to set it up, not "down"
  await expect(page.getByRole('link', {name: 'No render server set up'})).toBeVisible()

  await page.getByRole('button', {name: 'New film'}).first().click()
  const film = page.locator('dialog')
  await film.getByPlaceholder('the-last-lighthouse').fill('night')
  await film.locator('textarea').first().fill('A lighthouse keeper')
  await film.getByPlaceholder('90').fill('60')
  await film.getByRole('button', {name: 'Create'}).click()
  await expect(page).toHaveURL(/\/p\/film\/night\/story$/)
  expect(asked.at(-1)).toEqual({url: expect.stringContaining('/api/films/new'), body: {id: 'night', idea: 'A lighthouse keeper', length: '60'}})

  await page.goto(base)
  await page.getByRole('button', {name: 'New music video'}).first().click()
  const song = page.locator('dialog')
  await song.getByPlaceholder('well-of-youth').fill('rain')
  await song.getByRole('button', {name: 'A song to be made'}).click()
  await song.locator('textarea').first().fill('A song about rain')
  await song.getByRole('button', {name: 'Create'}).click()
  await expect(page).toHaveURL(/\/p\/music\/rain\/story$/)
  expect(asked.at(-1)?.body).toEqual({id: 'rain', idea: 'A song about rain'})
})

test('a new music video: the id from its name and checked, a song chosen and sent, who sings and the language as choices (#939)', async ({page}) => {
  await page.route('**/api/projects', route =>
    route.fulfill({json: {projects: [{id: 'rain', kind: 'music', title: 'rain', changed: 1, clips: 0, rendered: 0, plan: {stage: 'plan'}}]}}),
  )
  await page.route('**/api/library/assets', route => route.fulfill({json: {dir: 'library', assets: [], songs: []}}))
  // what the form sends is read, and the real editor makes the project: init copies the song in, its upload goes
  let asked: Record<string, unknown> | undefined
  await page.route('**/api/projects/new', async route => {
    asked = route.request().postDataJSON() as Record<string, unknown>
    await route.fallback()
  })
  await page.goto(base)
  await page.getByRole('button', {name: 'New music video'}).first().click()
  const form = page.locator('dialog')
  // the id follows the name, until it is changed by hand
  await form.getByPlaceholder('Well of Youth').fill('Rain')
  const id = form.getByPlaceholder('well-of-youth')
  await expect(id).toHaveValue('rain')
  await expect(form).toContainText('There is a project "rain" already')
  await id.fill('storm-song')
  await expect(form).not.toContainText('already')
  await form.getByPlaceholder('Well of Youth').fill('Rain at night')
  await expect(id).toHaveValue('storm-song')
  // a file chosen is sent at once (the real editor takes it), never a fakepath
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2, 3, 4])
  await form.getByLabel('Choose the song file').setInputFiles({name: 'my song.wav', mimeType: 'audio/wav', buffer: wav})
  await expect(form.getByRole('status')).toContainText('my song.wav')
  await form.locator('textarea').first().fill('Rain falls')
  // who sings, and the language - named as it is typed
  await form.getByLabel('These people:').check()
  await form.getByLabel('Who sings, by name').fill('Lira')
  const language = form.getByRole('combobox', {name: 'Language of the lyrics'})
  await language.fill('de')
  await expect(form).toContainText('German')
  await form.getByRole('button', {name: 'Create'}).click()
  await expect(page).toHaveURL(/\/p\/music\/storm-song\/story$/)
  expect(asked).toMatchObject({id: 'storm-song', lyrics: 'Rain falls', singers: 'Lira', language: 'de'})
  expect(String(asked?.song)).toMatch(/workspace-song-\w+[\\/]song\.wav$/)
  expect(String(asked?.song)).not.toContain('fakepath')
  expect(existsSync(String(asked?.song))).toBe(false)
})
