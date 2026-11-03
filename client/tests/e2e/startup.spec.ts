import {test, expect} from '@playwright/test'
import {startEditor} from './editor'

let editor: Awaited<ReturnType<typeof startEditor>>
let base: string
test.beforeAll(async () => { editor = await startEditor(); base = editor.base })
test.afterAll(async () => { await editor?.stop() })

test('production Vue assets boot through Bun, with navigation and direct project routes', async ({page, request}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const origins = new Set<string>()
  page.on('request', request => origins.add(new URL(request.url()).origin))
  await page.goto(base)
  await expect(page.getByRole('heading', {name: 'Projects', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'All projects', exact: true})).toBeVisible()
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
  const projects = Array.from({length: 27}, (_, n) => ({id: `film-${n}`, kind: 'film', title: `Film ${n}`, group: `film/${n}`, clips: 2, rendered: 2, final: 'current', changed: 27 - n, pictures: 0}))
  const music = {id: 'song-2', kind: 'music', title: 'Song newest', group: 'music/song', clips: 2, rendered: 1, final: 'missing', changed: 30, pictures: 0}
  await page.route('**/api/projects', route => route.fulfill({json: {projects: [music, {...music, id: 'song-1', title: 'Song older'}, ...projects]}}))
  await page.route('**/api/status', route => route.fulfill({json: {clips: {stale: 1}, pictures: {stale: 2}, next: {command: 'bun run music', why: 'Render remaining clips'}}}))
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
  const asset = {id: 'ann', kind: 'character', name: 'Ann', description: '<script>plain description</script>', anchors: 'Red coat', frames: [], usedBy: [{kind: 'film', id: 'demo', role: 'lead'}]}
  await page.route('**/api/library/assets', route => fail ? route.fulfill({status: 503, json: {error: 'Library unavailable'}}) : route.fulfill({json: {dir: '/fixture', assets: [asset]}}))
  await page.route('**/api/library/create', route => { posts.push(route.request().url()); return route.fulfill({json: {run: {source: 'here', command: 'bun tools/create-asset.ts', pid: 1, startedAt: '', running: true}}}) })
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
