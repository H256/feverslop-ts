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

test('settings wrap long defaults and show editable descriptions at desktop and mobile widths', async ({page}, testInfo) => {
  await page.emulateMedia({colorScheme: 'dark'})
  await stubProject(page)
  const description = 'a plain adult man in his thirties with a neutral expression, short dark hair and a plain grey t-shirt'
  const settings = [
    {
      key: 'videoResolution',
      label: 'Video size',
      group: 'Size',
      control: 'text',
      value: '1280x720',
      default: '1280x720',
      own: false,
      note: 'Size of the rendered video.',
    },
    {
      key: 'lipsyncScale',
      label: 'Size of the preview',
      group: 'Lip-sync preview',
      control: 'number',
      value: 0.125,
      default: 0.125,
      own: false,
      note: 'A fraction of the video pixels. At 0.125, width and height are about one third of the original.',
    },
    {
      key: 'lipsyncDummies',
      label: 'Dummy singers',
      group: 'Lip-sync preview',
      control: 'select',
      value: 1,
      default: 1,
      own: false,
      choices: [
        {value: 1, label: '1: one dummy sings everything'},
        {value: 2, label: '2: two dummy singers'},
      ],
      note: 'Who sings in the preview.',
    },
    ...['First dummy', 'Second dummy'].map((label, n) => ({
      key: n ? 'lipsyncDummy2' : 'lipsyncDummy',
      label,
      group: 'Lip-sync preview',
      control: 'text',
      multiline: true,
      value: description,
      default: description,
      own: false,
      note: 'Describe the singer used to preview the saved timing.',
    })),
  ]
  await page.route('**/api/config', route => (route.request().method() === 'GET' ? route.fulfill({json: {settings}}) : route.fallback()))
  for (const width of [1557, 640, 390]) {
    await page.setViewportSize({width, height: 1000})
    await page.goto(`${editor.base}/p/music/demo/settings`)
    await page.getByRole('navigation', {name: 'Settings sections'}).getByRole('link', {name: 'Lip-sync preview'}).click()
    const prompt = page.getByLabel('First dummy', {exact: true})
    await expect(prompt).toHaveValue(description)
    expect(await prompt.evaluate(el => el.tagName)).toBe('TEXTAREA')
    const overflows = await page
      .locator('.sf-row, .sf-default, .sf-note, .se-group')
      .evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length)
    expect(overflows).toBe(0)
    expect(await prompt.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({path: testInfo.outputPath(`settings-${width}.png`), fullPage: true})
  }
  const prompt = page.getByLabel('First dummy', {exact: true})
  await prompt.fill('A singer with short hair.\nA plain blue shirt.')
  const row = page.locator('.sf-row').filter({has: prompt})
  await row.getByRole('button', {name: 'Undo', exact: true}).click()
  await expect(prompt).toHaveValue(description)
})
