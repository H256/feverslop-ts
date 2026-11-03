import {test, expect, type Page} from '@playwright/test'
import {startEditor} from './editor'
import {stubProject, type Posted} from './fixtures'

let editor: Awaited<ReturnType<typeof startEditor>>
let base: string
test.beforeAll(async () => { editor = await startEditor(); base = editor.base })
test.afterAll(async () => { await editor?.stop() })

let posted: Posted[]
let errors: string[]
test.beforeEach(async ({page}) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  posted = await stubProject(page)
})
test.afterEach(() => { expect(errors).toEqual([]) })
const dialog = (page: Page) => page.getByRole('dialog')
const paths = () => posted.map(p => p.path)

test('timeline: the clip at the playhead, its tabs, and a render asked before it runs', async ({page}) => {
  await page.goto(`${base}/p/music/demo/#clip-1`)
  await expect(page.getByRole('heading', {name: 'Demo song'})).toBeVisible()
  await expect(page.getByRole('navigation', {name: 'Project'}).getByRole('link', {name: 'Timeline'})).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', {name: 'clip-1, Current'})).toBeVisible()
  await expect(page.getByRole('button', {name: 'clip-2, Not rendered'})).toBeVisible()
  await expect(page.locator('.ihead h2')).toContainText('clip-1')
  await expect(page.getByText('Next: Render 1 clip')).toBeVisible()
  await page.getByRole('tab', {name: /Shots/}).click()
  await expect(page.getByText('Ann walks into the bar')).toBeVisible()
  await expect(page.getByRole('link', {name: 'Change singers'})).toHaveAttribute('href', '/p/music/demo/singers#line-0')
  await page.getByRole('tab', {name: 'Render'}).click()
  await page.getByRole('button', {name: 'Render again'}).click()
  await expect(dialog(page)).toContainText('about 2 min')
  await expect(dialog(page).getByRole('checkbox', {name: /gpu/})).toBeChecked()
  await expect(dialog(page).getByRole('checkbox', {name: /old/})).toBeDisabled()
  await page.getByRole('button', {name: 'Cancel'}).click()
  expect(paths()).toEqual(['estimate'])
  await page.getByRole('button', {name: 'Render again'}).click()
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect.poll(() => posted.at(-1)?.body).toEqual({action: {type: 'clips', ids: ['clip-1'], again: true}, servers: ['gpu']})
  await expect(page.getByRole('region', {name: 'Run'})).toContainText('bun index.ts demo')
  // the next clip, by key: the inspector and the address follow
  await page.locator('body').press('ArrowRight')
  await expect(page.locator('.ihead h2')).toContainText('clip-2')
  await expect(page).toHaveURL(/#clip-2$/)
})

test('story: a changed story is saved after the question, and leaving with changes asks first', async ({page}) => {
  await page.goto(`${base}/p/music/demo/story`)
  const text = page.getByRole('textbox', {name: 'Story'})
  await expect(text).toHaveValue('Once upon a time')
  await expect(page.getByRole('button', {name: 'Save the story'})).toBeDisabled()
  await text.fill('Once upon a night')
  await page.getByRole('navigation', {name: 'Project'}).getByRole('link', {name: 'Casting'}).click()
  await expect(dialog(page)).toContainText('Leave without saving?')
  await dialog(page).getByRole('button', {name: 'Cancel'}).click()
  await expect(page).toHaveURL(/\/story$/)
  await page.getByRole('button', {name: 'Save the story'}).click()
  await expect(dialog(page)).toContainText('What is built on the story goes: summary.')
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'book')?.body).toEqual({text: 'Once upon a night'})
})

test('casting: a library asset for a role, asked with what goes stale', async ({page}) => {
  await page.goto(`${base}/p/music/demo/casting`)
  await page.getByLabel('Who plays Ann').selectOption('library:kael')
  await expect(dialog(page)).toContainText('1 clip go stale: clip-1')
  await dialog(page).getByRole('button', {name: 'Change it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'casting')?.body).toEqual({kind: 'character', id: 'ann', value: 'library:kael'})
  await page.getByRole('button', {name: 'Edit the cast'}).click()
  await page.getByRole('button', {name: 'Add a place'}).click()
  await page.getByRole('textbox', {name: 'Name'}).last().fill('Roof')
  await page.getByRole('button', {name: 'Save the cast'}).click()
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'cast')?.body).toEqual({characters: [{id: 'ann', name: 'Ann', role: 'singer'}], locations: [{id: 'bar', name: 'Bar'}, {name: 'Roof'}]})
})

test('look: one text changed and one written anew, saved together', async ({page}) => {
  await page.goto(`${base}/p/music/demo/look`)
  await page.getByLabel('Description - what the clip prompts say of it').fill('a tall woman')
  await page.getByLabel('Write anew').check()
  await expect(page.getByText('1 text changed · 1 to write anew')).toBeVisible()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect(dialog(page)).toContainText('What is planned from the looks goes: beats.')
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'look')?.body).toEqual({elements: [{kind: 'character', id: 'ann', description: 'a tall woman'}], again: [{kind: 'character', id: 'ann'}]})
})

test('references: a picture rendered again with its edited prompt', async ({page}) => {
  await page.goto(`${base}/p/music/demo/references`)
  await expect(page.getByRole('heading', {name: 'Ann', level: 2}).last()).toBeVisible()
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Ann in blue')
  await page.getByRole('button', {name: 'Render again'}).click()
  await expect(dialog(page)).toContainText('The edited prompt is kept with this picture')
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'references/ann/rerender')?.body).toEqual({newAnchor: false, prompt: 'Ann in blue', servers: ['gpu']})
})

test('singers: a singer added by key, and the change saved with what it does', async ({page}) => {
  await page.goto(`${base}/p/music/demo/singers#line-0`)
  await page.getByLabel('Add a singer').selectOption('ben')
  const line = page.locator('#line-0')
  await expect(line).toBeFocused()
  await line.press('2')
  await expect(page.getByText('1 line changed')).toBeVisible()
  await expect(page.getByText(/Ben becomes a singer of the song/)).toBeVisible()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'singing')?.body).toEqual({lines: [{line: 0, singers: ['ann', 'ben']}]})
})

test('timing: a line moved by key, undone, moved again and saved', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  const editorBox = page.locator('.tedit')
  await expect(editorBox).toBeFocused()
  await editorBox.press('Shift+ArrowRight')
  await expect(page.getByText('1 line moved')).toBeVisible()
  await editorBox.press('Control+z')
  await expect(page.getByText('1 line moved')).toHaveCount(0)
  await editorBox.press('Shift+ArrowRight')
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'timing')?.body).toEqual({lines: [{line: 0, words: [{start: 1.5, end: 2.5}, {start: 2.5, end: 3.5}]}]})
})
