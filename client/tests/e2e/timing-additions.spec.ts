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

test('a roughly moved block can save and refine its words without resetting manual placement', async ({page}) => {
  const posted = await stubProject(page)
  const prepared: unknown[] = []
  await page.route('**/api/timing-refine', async route => {
    expect(posted.some(p => p.path === 'timing')).toBe(true)
    prepared.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        id: 'block-preview',
        language: 'de',
        fingerprint: 'fixture',
        model: 'fixture',
        passage: {line: 0, start: 1, end: 3, targets: [0], mode: 'line-window'},
        change: {
          lines: [
            {
              line: 0,
              words: [
                {text: 'Hello', start: 1.4, end: 2},
                {text: 'night', start: 2, end: 3},
              ],
            },
          ],
        },
        entries: [{line: 0, text: 'Hello night', before: [1, 3], after: [1.4, 3], status: 'refined', reason: 'Listen to check.'}],
        logFile: 'logs/timing-refinement/test.log',
      },
    })
  })
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await page.locator('.tline').first().scrollIntoViewIfNeeded()
  const box = (await page.locator('.tline').first().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, {steps: 5})
  await page.mouse.up()
  const retry = page.getByRole('button', {name: 'Save changes & refine words', exact: true})
  await expect(retry).toBeEnabled()
  await retry.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Only the selected block')
  await dialog.getByRole('button', {name: 'Save changes & prepare', exact: true}).click()
  await expect.poll(() => prepared).toEqual([{language: 'de', passage: {line: 0, confirmSung: true, mode: 'line-window'}}])
  await expect(page.getByRole('button', {name: 'Apply word refinement', exact: true})).toBeVisible()
  await expect(page.getByText('logs/timing-refinement/test.log', {exact: true})).toBeVisible()
  expect(posted.filter(p => p.path === 'timing')).toHaveLength(1)
})

test('confirmed passage prepares without saving and applies only its reviewed proposal', async ({page}) => {
  const posted = await stubProject(page)
  const prepared: unknown[] = [],
    applied: unknown[] = []
  await page.route('**/api/timing-refine', async route => {
    prepared.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        id: 'passage-preview',
        language: 'de',
        fingerprint: 'fixture',
        model: 'fixture',
        passage: {line: 0, start: 0, end: 6, targets: [0]},
        change: {
          lines: [
            {
              line: 0,
              words: [
                {text: 'Hello', start: 1.4, end: 2},
                {text: 'night', start: 2, end: 3},
              ],
            },
          ],
        },
        entries: [{line: 0, text: 'Hello night', before: [1, 3], after: [1.4, 3], status: 'refined', reason: 'Listen to check.'}],
      },
    })
  })
  await page.route('**/api/timing-refine-apply', async route => {
    applied.push(route.request().postDataJSON())
    await route.fulfill({json: {changed: [0], slots: [], replanned: [], staleClips: [], crossing: []}})
  })
  await page.goto(`${editor.base}/p/music/demo/timing`)
  const retry = page.getByRole('button', {name: 'Retry sung passage', exact: true})
  await retry.click()
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click()
  expect(prepared).toEqual([])
  await retry.click()
  await page.getByRole('dialog').getByRole('button', {name: 'This line is sung — prepare', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Listen before', exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: 'Listen to proposal', exact: true})).toBeVisible()
  expect(prepared).toEqual([{language: 'de', passage: {line: 0, confirmSung: true}}])
  expect(posted.filter(p => p.path === 'timing')).toEqual([])
  expect(applied).toEqual([])
  await page.getByRole('button', {name: 'Apply passage', exact: true}).click()
  await expect.poll(() => applied).toEqual([{id: 'passage-preview'}])
  await page.getByRole('button', {name: 'Mark reviewed', exact: true}).click()
  await expect(retry).toBeDisabled()
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
