import {test, expect} from '@playwright/test'
import {startEditor} from './editor'
import {stubProject} from './fixtures'

let editor: Awaited<ReturnType<typeof startEditor>>
test.beforeAll(async () => {
  editor = await startEditor()
})
test.afterAll(async () => {
  await editor?.stop()
})

test('omitted overlapping words do not intercept dragging; deliberate list selection still edits them', async ({page}) => {
  const posted = await stubProject(page)
  const lines = [
    {line: 0, section: 'Verse', text: 'active', words: [{text: 'active', start: 2, end: 4}], estimated: true, byHand: false, beats: []},
    {line: 1, section: 'Verse', text: 'omitted', words: [{text: 'omitted', start: 2, end: 4}], estimated: false, byHand: false, off: true, beats: []},
  ]
  await page.route('**/api/timing', r =>
    r.request().method() === 'POST' ? r.fallback() : r.fulfill({json: {timing: {duration: 10, lines, cuts: [], beats: [], unplanned: [], outdated: []}}}),
  )
  await page.goto(`${editor.base}/p/music/demo/timing`)
  const word = page.locator('.tword:not(.other)').first()
  const box = (await word.boundingBox())!
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  expect(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest('.tword')?.textContent?.trim(), {x, y})).toBe('active')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 30, y, {steps: 5})
  await page.mouse.up()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'timing')?.body).toMatchObject({lines: [{line: 0}]})
  await page.locator('.tline-row').filter({hasText: 'omitted'}).click()
  await expect(page.locator('.tword.off:not(.other)')).toHaveCSS('pointer-events', 'auto')
})

test('missing words can be inserted with explicit timing', async ({page}) => {
  const posted = await stubProject(page)
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await page.getByRole('button', {name: 'Add words', exact: true}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Missing words').fill('oh yeah')
  await dialog.getByLabel('Start (seconds)').fill('3')
  await dialog.getByLabel('End (seconds)').fill('4')
  await dialog.getByRole('button', {name: 'Add words & save', exact: true}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          off: false,
          insert: {
            at: 2,
            words: [
              {text: 'oh', start: 3, end: 3.5},
              {text: 'yeah', start: 3.5, end: 4},
            ],
          },
        },
      ],
    })
})

test('an ad-lib can be enabled while saving its pending review', async ({page}) => {
  const posted = await stubProject(page)
  await page.route('**/api/timing', route =>
    route.request().method() === 'POST'
      ? route.fallback()
      : route.fulfill({
          json: {
            timing: {
              duration: 10,
              lines: [
                {
                  line: 0,
                  section: 'Outro',
                  text: 'sein Herz!',
                  words: [
                    {text: 'sein', start: 2, end: 3},
                    {text: 'Herz!', start: 3, end: 6},
                  ],
                  estimated: true,
                  byHand: false,
                  adlib: true,
                  off: true,
                  beats: [],
                },
              ],
              cuts: [],
              beats: [],
              unplanned: [],
              outdated: [],
            },
          },
        }),
  )
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await page.getByRole('button', {name: 'Mark reviewed', exact: true}).click()
  const enable = page.getByRole('button', {name: 'Save changes & Sing it', exact: true})
  await expect(enable).toBeEnabled()
  await enable.click()
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          off: false,
          words: [
            {text: 'sein', estimated: false},
            {text: 'Herz!', estimated: false},
          ],
        },
      ],
    })
})
test('a new separate lyric segment can be added', async ({page}) => {
  const posted = await stubProject(page)
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await page.getByRole('button', {name: 'Add words', exact: true}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Add to').selectOption('line')
  await dialog.getByLabel('Missing words').fill('oh')
  await dialog.getByLabel('Start (seconds)').fill('4')
  await dialog.getByLabel('End (seconds)').fill('5')
  await dialog.getByRole('button', {name: 'Add words & save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'timing')?.body).toMatchObject({lines: [], add: {afterLine: 0, words: [{text: 'oh', start: 4, end: 5}]}})
})
