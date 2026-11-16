import {test, expect, type Page} from '@playwright/test'
import {startEditor} from './editor'
import {stubProject} from './fixtures'

let editor: Awaited<ReturnType<typeof startEditor>>
test.beforeAll(async () => {
  editor = await startEditor()
})
test.afterAll(async () => {
  await editor?.stop()
})

// the line actions that are rarely needed sit in the "More" menu of the bar
const more = (page: Page) => page.locator('.tw-more > summary').click()

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
  await more(page)
  await retry.click()
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click()
  expect(prepared).toEqual([])
  await more(page)
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
  await more(page)
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
  await more(page)
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
  await more(page)
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
  await more(page)
  await page.getByRole('button', {name: 'Add words', exact: true}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Add to').selectOption('line')
  await dialog.getByLabel('Missing words').fill('oh')
  await dialog.getByLabel('Start (seconds)').fill('4')
  await dialog.getByLabel('End (seconds)').fill('5')
  await dialog.getByRole('button', {name: 'Add words & save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'timing')?.body).toMatchObject({lines: [], add: {afterLine: 0, words: [{text: 'oh', start: 4, end: 5}]}})
})

test('the proposal of the refinement is drawn on the timeline and a line is taken on its own', async ({page}) => {
  await stubProject(page)
  const applied: unknown[] = []
  const proposal = {
    id: 'song-preview',
    language: 'de',
    fingerprint: 'fixture',
    model: 'fixture',
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
    entries: [{line: 0, text: 'Hello night', before: [1, 3], after: [1.4, 3], status: 'refined', reason: 'Phoneme alignment; listen to check.'}],
  }
  await page.route('**/api/timing-refine', route => route.fulfill({json: proposal}))
  await page.route('**/api/timing-refine-apply', async route => {
    applied.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        changed: [0],
        slots: [],
        replanned: [],
        staleClips: [],
        crossing: [],
        refinement: {...proposal, change: {lines: []}, entries: [{...proposal.entries[0], status: 'applied', reason: 'Taken.'}]},
      },
    })
  })
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await page.getByText('Refine timing from vocals').click()
  await page.getByRole('button', {name: 'Prepare refinement', exact: true}).click()
  await expect(page.locator('.tproposal')).toHaveCount(2)
  await expect(page.getByRole('region', {name: 'Refinement proposal'})).toContainText('Phoneme alignment')
  await page.locator('.tedit').focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => applied).toEqual([{id: 'song-preview', lines: [0]}])
  await expect(page.locator('.tproposal')).toHaveCount(0)
})

test('two lines that run into each other share one boundary handle: dragging it moves the earlier end and the later start', async ({page}) => {
  const posted = await stubProject(page)
  const lines = [
    {
      line: 0,
      section: 'Chorus',
      text: 'Ich bin',
      words: [
        {text: 'Ich', start: 1, end: 2},
        {text: 'bin', start: 2, end: 3},
      ],
      estimated: false,
      byHand: false,
      beats: [],
    },
    {
      line: 1,
      section: 'Chorus',
      text: 'nicht mehr',
      words: [
        {text: 'nicht', start: 2.5, end: 3.5},
        {text: 'mehr', start: 3.5, end: 5},
      ],
      estimated: false,
      byHand: false,
      beats: [],
    },
  ]
  await page.route('**/api/timing', r =>
    r.request().method() === 'POST' ? r.fallback() : r.fulfill({json: {timing: {duration: 10, lines, cuts: [], beats: [], unplanned: [], outdated: []}}}),
  )
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await expect(page.locator('.toverlap')).toHaveCount(1)
  const joint = page.locator('.tjoint')
  const box = (await joint.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, {steps: 6})
  await page.mouse.up()
  await expect(page.locator('.toverlap')).toHaveCount(0)
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'timing')?.body).toMatchObject({lines: [{line: 0}, {line: 1}]})
})

test('a boundary without an overlap shows its handle only on hover', async ({page}) => {
  await stubProject(page)
  const lines = [
    {
      line: 0,
      section: 'Chorus',
      text: 'Ich bin',
      words: [
        {text: 'Ich', start: 1, end: 2},
        {text: 'bin', start: 2, end: 3},
      ],
      estimated: false,
      byHand: false,
      beats: [],
    },
    {
      line: 1,
      section: 'Chorus',
      text: 'nicht mehr',
      words: [
        {text: 'nicht', start: 3.2, end: 4},
        {text: 'mehr', start: 4, end: 5},
      ],
      estimated: false,
      byHand: false,
      beats: [],
    },
  ]
  await page.route('**/api/timing', r =>
    r.request().method() === 'POST' ? r.fallback() : r.fulfill({json: {timing: {duration: 10, lines, cuts: [], beats: [], unplanned: [], outdated: []}}}),
  )
  await page.goto(`${editor.base}/p/music/demo/timing`)
  const joint = page.locator('.tjoint')
  await expect(joint).toHaveCount(1)
  await expect(page.locator('.toverlap')).toHaveCount(0)
  await expect(joint).toHaveCSS('opacity', '0')
  const box = (await joint.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(joint).toHaveCSS('opacity', '1')
})

test('B chooses a boundary, the arrows move it, Esc leaves it', async ({page}) => {
  await stubProject(page)
  const lines = [
    {
      line: 0,
      section: 'Chorus',
      text: 'Ich bin',
      words: [
        {text: 'Ich', start: 1, end: 2},
        {text: 'bin', start: 2, end: 3},
      ],
      estimated: false,
      byHand: false,
      beats: [],
    },
    {
      line: 1,
      section: 'Chorus',
      text: 'nicht mehr',
      words: [
        {text: 'nicht', start: 2.5, end: 3.5},
        {text: 'mehr', start: 3.5, end: 5},
      ],
      estimated: false,
      byHand: false,
      beats: [],
    },
  ]
  await page.route('**/api/timing', r =>
    r.request().method() === 'POST' ? r.fallback() : r.fulfill({json: {timing: {duration: 10, lines, cuts: [], beats: [], unplanned: [], outdated: []}}}),
  )
  await page.goto(`${editor.base}/p/music/demo/timing`)
  await expect(page.locator('.toverlap')).toHaveCount(1)
  await page.locator('.tedit').focus()
  await page.keyboard.press('b')
  await expect(page.locator('.tjoint.active')).toHaveCount(1)
  for (let n = 0; n < 11; n++) await page.keyboard.press('ArrowRight')
  await expect(page.locator('.toverlap')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.tjoint.active')).toHaveCount(0)
  // every press is one step back, as with a line
  for (let n = 0; n < 11; n++) await page.keyboard.press('Control+z')
  await expect(page.locator('.toverlap')).toHaveCount(1)
})
