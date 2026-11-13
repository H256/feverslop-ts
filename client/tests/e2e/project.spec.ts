import {test, expect, type Page} from '@playwright/test'
import {startEditor} from './editor'
import {stubProject, type Posted} from './fixtures'

let editor: Awaited<ReturnType<typeof startEditor>>
let base: string
test.beforeAll(async () => {
  editor = await startEditor()
  base = editor.base
})
test.afterAll(async () => {
  await editor?.stop()
})

let posted: Posted[]
let errors: string[]
test.beforeEach(async ({page}) => {
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  posted = await stubProject(page)
})
test.afterEach(() => {
  expect(errors).toEqual([])
})
const dialog = (page: Page) => page.getByRole('dialog')
const paths = () => posted.map(p => p.path)

test('timeline: the clip at the playhead, its tabs, and a render asked before it runs', async ({page}) => {
  await page.goto(`${base}/p/music/demo/#clip-1`)
  await expect(page.getByRole('heading', {name: 'Demo song'})).toBeVisible()
  await expect(page.getByRole('navigation', {name: 'Project'}).getByRole('link', {name: 'Timeline'})).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', {name: 'clip-1, Current'})).toBeVisible()
  await expect(page.getByRole('button', {name: 'clip-2, Not rendered'})).toBeVisible()
  await expect(page.locator('.ihead h2')).toContainText('clip-1')
  // the next step: a bar under the tabs of every project page (#833)
  await expect(page.getByLabel('Next step')).toContainText('Render 1 clip')
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
  // a link to a clip on the open page: the playhead goes there
  await page.evaluate(() => {
    location.hash = 'clip-1'
  })
  await expect(page.locator('.ihead h2')).toContainText('clip-1')
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
  await expect(dialog(page)).toContainText('What is built on the story goes: 1 step of the story.')
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'book')?.body).toEqual({text: 'Once upon a night'})
})

test('casting: a library asset for a role, asked with what goes stale', async ({page}) => {
  await page.goto(`${base}/p/music/demo/casting`)
  await expect(page.locator('.role').first()).toContainText('Ann ann')
  await page.getByLabel('Who plays Ann').selectOption('library:kael')
  await expect(dialog(page)).toContainText('1 clip go stale: clip-1')
  await dialog(page).getByRole('button', {name: 'Change it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'casting')?.body).toEqual({kind: 'character', id: 'ann', value: 'library:kael'})
  // adding starts from the list of roles: the cast by hand opens with the new place, its name to type
  await page.getByRole('button', {name: 'Add a place'}).click()
  await expect(page.getByRole('textbox', {name: 'Name'}).last()).toBeFocused()
  await page.keyboard.type('Roof')
  await page.getByRole('button', {name: 'Save the cast'}).click()
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'cast')?.body)
    .toEqual({characters: [{id: 'ann', name: 'Ann', role: 'singer'}], locations: [{id: 'bar', name: 'Bar'}, {name: 'Roof'}]})
})

test('casting: the props with pictures of their own, one of the library taken for a character (#944)', async ({page}) => {
  const role = (kind: 'character' | 'location', id: string, name: string) => ({kind, id, name, copied: false, clips: [], errors: [], warnings: []})
  await page.route(/\/p\/music\/demo\/api\/casting$/, route =>
    route.fulfill({
      json: {
        roles: [role('character', 'ann', 'Ann'), role('location', 'bar', 'Bar')],
        errors: [],
        warnings: [],
        options: {character: [], location: []},
        propPictures: true,
        props: [{character: 'ann', characterName: 'Ann', id: 'electric-guitar', name: 'electric guitar', description: 'an electric guitar', clips: ['clip-1']}],
        libraryProps: [{id: 'strat', name: 'sunburst Strat', description: 'a sunburst Stratocaster'}],
      },
    }),
  )
  await page.goto(`${base}/p/music/demo/casting`)
  const props = page.locator('[data-props]')
  await expect(props).toContainText('electric guitar')
  await expect(props).toContainText('of Ann')
  await props.getByRole('button', {name: 'A prop of the library for Ann'}).click()
  await expect(dialog(page)).toContainText('The prop is in 1 clip')
  await dialog(page).getByLabel('The prop Ann gets').selectOption('strat')
  await expect(dialog(page)).toContainText('a sunburst Stratocaster')
  await dialog(page).getByRole('button', {name: 'Take it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'run')?.body).toMatchObject({action: {type: 'import-prop', prop: 'strat', character: 'ann'}})
})

test('casting: roles removed on their cards, put back, and saved together from the bar', async ({page}) => {
  await page.goto(`${base}/p/music/demo/casting`)
  await page.getByRole('button', {name: 'Remove Ann'}).click()
  // the page stays the list of roles: the card is marked, the bar below counts what goes
  await expect(page.locator('.role.out')).toContainText('Out of the cast when saved.')
  await expect(page.locator('.castbar')).toContainText('Out of the cast when saved: 1 character')
  await expect(page.getByRole('textbox', {name: 'Name'})).toHaveCount(0)
  await page.getByRole('button', {name: 'Put back Ann'}).click()
  await expect(page.locator('.castbar')).toBeHidden()
  await page.getByRole('button', {name: 'Remove Bar'}).click()
  await expect(page.locator('.castbar')).toContainText('1 place')
  await page.getByRole('button', {name: 'Save the cast'}).click()
  await expect(dialog(page)).toContainText('Out of the cast: Bar.')
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'cast')?.body).toEqual({characters: [{id: 'ann', name: 'Ann', role: 'singer'}], locations: []})
})

test('casting a film: a role added and one taken out start the screenplay told anew (#589)', async ({page}) => {
  const filmPosted = await stubProject(page, 'film')
  await page.goto(`${base}/p/film/demo/casting`)
  await page.getByRole('button', {name: 'Add a character'}).click()
  await expect(page.locator('[data-cast="new-film-role"] input[aria-label="Name"]')).toBeFocused()
  await page.locator('[data-cast="new-film-role"] input[aria-label="Name"]').fill('Kai')
  await page.locator('[data-cast="new-film-role"] textarea[aria-label="Role in the story"]').fill('the night porter')
  await page.getByRole('button', {name: 'Remove Bo'}).click()
  await expect(page.locator('.role.out')).toContainText('Out of the screenplay told anew.')
  await expect(page.locator('.castbar')).toContainText('New: 1 character, out: 1 character')
  await page.getByRole('button', {name: 'Tell the screenplay anew'}).click()
  await expect(dialog(page)).toContainText('new: Kai · gone: Bo')
  await expect(dialog(page)).toContainText('Taking it drops what is read from the script')
  await dialog(page).getByRole('button', {name: 'Have it written'}).click()
  await expect
    .poll(() => filmPosted.find(p => p.path === 'run')?.body)
    .toMatchObject({action: {type: 'adapt-story', add: [{name: 'Kai', role: 'the night porter'}], remove: ['bo']}})
  await expect(page.locator('.castbar')).toBeHidden()
})

test('the story of a film: the screenplay told anew waits next to it, and is taken after the question', async ({page}) => {
  const filmPosted = await stubProject(page, 'film')
  await page.goto(`${base}/p/film/demo/story`)
  await expect(page.getByText('A screenplay told anew for the cast as it is now (new: Kai · gone: Bo)')).toBeVisible()
  await page.getByRole('button', {name: 'Take the new screenplay'}).click()
  await expect(dialog(page)).toContainText('Who stays keeps their id and their looks')
  await expect(dialog(page)).toContainText('What is read from the script goes')
  await dialog(page).getByRole('button', {name: 'Take it'}).click()
  await expect.poll(() => filmPosted.find(p => p.path === 'book/for-cast')?.body).toEqual({proposal: true})
})

test('look: one text changed and one written anew, saved together', async ({page}) => {
  await page.goto(`${base}/p/music/demo/look`)
  await page.getByLabel('Description - what the clip prompts say of it').fill('a tall woman')
  await page.getByLabel('Write anew').check()
  await expect(page.getByText('1 text changed · 1 to write anew')).toBeVisible()
  await page.getByRole('button', {name: 'Save the looks', exact: true}).click()
  await expect(dialog(page)).toContainText('What is planned from the looks goes: 1 step of the shot plan.')
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'look')?.body)
    .toEqual({elements: [{kind: 'character', id: 'ann', description: 'a tall woman'}], again: [{kind: 'character', id: 'ann'}]})
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
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          words: [
            {start: 1.5, end: 2.5, estimated: true},
            {start: 2.5, end: 3.5, estimated: true},
          ],
        },
      ],
    })
})

// what the review found: answers that come late, changes made while saving, a refusal in a question, a draft of another pick
test('versions: a slow answer about the clip before never shows as the versions of this one', async ({page}) => {
  await page.route('**/api/versions/clip-1', async route => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.fulfill({json: {versions: [{id: 'old/clip-1', video: 'old/clip-1.mp4', source: 'again', made: 1, v: 1}]}})
  })
  await page.goto(`${base}/p/music/demo/#clip-1`)
  await page.getByRole('tab', {name: 'Versions'}).click()
  await expect(page.getByText('Looking…')).toBeVisible()
  await page.locator('body').press('ArrowRight')
  await expect(page.locator('.ihead h2')).toContainText('clip-2')
  await expect(page.getByText('No older versions')).toBeVisible()
  await page.waitForTimeout(800)
  await expect(page.getByRole('button', {name: 'Make current'})).toHaveCount(0)
})

test('singers: while a change is saved the page cannot be changed, and what was saved is reset only once read again', async ({page}) => {
  let release: () => void = () => {}
  await page.route('**/api/singing', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise<void>(resolve => {
      release = resolve
    })
    await route.fallback()
  })
  await page.goto(`${base}/p/music/demo/singers#line-0`)
  await page.getByLabel('Add a singer').selectOption('ben')
  await page.locator('#line-0').press('2')
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect(page.locator('.ui-split.view')).toHaveAttribute('inert', '')
  release()
  await expect(page.locator('.ui-split.view')).not.toHaveAttribute('inert', '')
  await expect(page.getByText('Saved.', {exact: false})).toBeVisible()
})

test('library: a question whose work the server refuses stays open, with what was filled in and why', async ({page}) => {
  await page.route('**/api/library/assets', route => route.fulfill({json: {dir: 'library', assets: []}}))
  await page.route('**/api/library/create', route => route.fulfill({status: 409, json: {error: 'library:kael already exists'}}))
  await page.goto(`${base}/library`)
  await page.getByRole('button', {name: 'New asset from a picture'}).click()
  // the picture is required: the form says so instead of closing
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect(dialog(page)).toBeVisible()
  await dialog(page)
    .getByLabel('Picture')
    .setInputFiles({name: 'kael.png', mimeType: 'image/png', buffer: Buffer.from('png')})
  await dialog(page).getByLabel('Library id').fill('kael')
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect(dialog(page).getByRole('alert')).toHaveText('library:kael already exists')
  await expect(dialog(page).getByLabel('Library id')).toHaveValue('kael')
})

test("references: a picture from an edited prompt shows it, and goes back to the plan's prompt unpinned", async ({page}) => {
  await page.goto(`${base}/p/music/demo/references#cem`)
  const prompt = page.getByRole('textbox', {name: 'Prompt'})
  await expect(prompt).toHaveValue('Cem in green')
  await expect(page.getByText('Edited: the plan has another prompt.')).toBeVisible()
  await page.getByRole('button', {name: "Take the plan's prompt"}).click()
  await expect(prompt).toHaveValue('Cem in grey')
  await page.getByRole('button', {name: 'Render again'}).click()
  await expect(dialog(page)).toContainText('the new picture is not pinned')
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'references/cem/rerender')?.body).toEqual({newAnchor: false, servers: ['gpu']})
})

test('references: your own picture goes up as the anchor, with a description written by hand', async ({page}) => {
  await page.goto(`${base}/p/music/demo/references#ann`)
  await page.getByRole('button', {name: 'Use my own anchor'}).click()
  await expect(dialog(page)).toContainText('What is there now is put away as an older version')
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082',
    'hex',
  )
  await dialog(page).getByLabel('Picture', {exact: true}).setInputFiles({name: 'mine.png', mimeType: 'image/png', buffer: png})
  await expect(dialog(page).getByRole('img', {name: 'The picture picked'})).toBeVisible()
  await expect(dialog(page).getByLabel('Prompt of the picture')).toHaveValue('Ann in red')
  await dialog(page).getByLabel('Description', {exact: true}).selectOption('text')
  await dialog(page).getByLabel('Description text').fill('a woman in a green coat')
  await dialog(page).getByRole('button', {name: 'Put it in'}).click()
  await expect.poll(() => posted.find(p => p.path === 'references/ann/own-anchor')?.body).toContain('a woman in a green coat')
  const form = String(posted.find(p => p.path === 'references/ann/own-anchor')!.body)
  expect(form).toContain('filename="mine.png"')
  expect(form).toContain('name="servers"')
  expect(form).not.toContain('name="describe"')
})

test('references: an edited prompt is not lost by picking another picture', async ({page}) => {
  await page.goto(`${base}/p/music/demo/references#ann`)
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Ann in blue')
  await page.getByRole('button', {name: /^Bar/}).click()
  await expect(dialog(page)).toContainText('changes to the prompt')
  await dialog(page).getByRole('button', {name: 'Cancel'}).click()
  await expect(page).toHaveURL(/#ann$/)
  await expect(page.getByRole('textbox', {name: 'Prompt'})).toHaveValue('Ann in blue')
})

test('timeline: a scrub the browser cancels leaves playing stopped; one let go plays on', async ({page}) => {
  await page.goto(`${base}/p/music/demo/#clip-1`)
  const play = page.locator('.tbtn.play')
  const ruler = page.locator('.lane.lane-ruler')
  const box = (await ruler.boundingBox())!
  await play.click()
  await expect(play).toHaveAttribute('aria-label', 'Pause')
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await expect(play).toHaveAttribute('aria-label', 'Play')
  await page.evaluate(() => dispatchEvent(new PointerEvent('pointercancel')))
  await page.mouse.up()
  await expect(play).toHaveAttribute('aria-label', 'Play')
  await play.click()
  await ruler.click({position: {x: 60, y: box.height / 2}})
  await expect(play).toHaveAttribute('aria-label', 'Pause')
})

test('library: an asset asked for in the library starts nothing in the project opened before the answer came', async ({page}) => {
  let answer: () => void = () => {}
  await page.route('**/api/library/assets', route => route.fulfill({json: {dir: 'library', assets: []}}))
  await page.route('**/api/library/create', async route => {
    await new Promise<void>(resolve => {
      answer = resolve
    })
    await route.fulfill({json: {run: {source: 'here', command: 'bun tools/create-asset.ts kael', pid: 9, startedAt: '2026-11-03T00:00:00Z', running: true}}})
  })
  await page.route('**/api/library/run-events*', route =>
    route.fulfill({status: 200, headers: {'Content-Type': 'text/event-stream'}, body: 'event: state\ndata: null\n\n'}),
  )
  // inside a project the top bar has Library only on a wide screen (#879)
  await page.setViewportSize({width: 1800, height: 1000})
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('navigation', {name: 'Workspace'}).getByRole('link', {name: 'Library'}).click()
  await page.getByRole('button', {name: 'New asset from a picture'}).click()
  await dialog(page)
    .getByLabel('Picture')
    .setInputFiles({name: 'kael.png', mimeType: 'image/png', buffer: Buffer.from('png')})
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect(dialog(page).getByRole('button', {name: 'Working…'})).toBeVisible()
  await page.goBack()
  await expect(page.locator('.ihead h2')).toContainText('clip-1')
  // the project follows its runs; a late answer of the library must not start that over from the start (after=0) for its run
  const reconnects: string[] = []
  page.on('request', request => {
    if (request.url().includes('/p/music/demo/api/run-events')) reconnects.push(request.url())
  })
  answer()
  await page.waitForTimeout(500)
  expect(reconnects).toEqual([])
  await expect(page.getByText('bun tools/create-asset.ts kael')).toHaveCount(0)
})

test('settings: a workflow chosen, the question says what it makes stale, and only the change is sent', async ({page}) => {
  await page.goto(`${base}/p/music/demo/settings`)
  await expect(page.getByRole('navigation', {name: 'Project'}).getByRole('link', {name: 'Settings'})).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Video workflow')).toHaveValue('h3-ref2video-2pass')
  await expect(page.getByRole('button', {name: 'Save', exact: true})).toBeDisabled()
  await page.getByLabel('Video workflow').selectOption('h3-ref2video-prism-2pass')
  await expect(page.getByRole('button', {name: 'Save', exact: true})).toBeEnabled()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect(dialog(page)).toContainText('Video workflow: h3-ref2video-2pass → h3-ref2video-prism-2pass')
  await expect(dialog(page)).toContainText('1 of 1 rendered clip would be made from something else then')
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect
    .poll(() => posted.filter(p => p.path === 'config').map(p => p.body))
    .toEqual([{change: {videoWorkflow: 'h3-ref2video-prism-2pass'}, dryRun: true}, {change: {videoWorkflow: 'h3-ref2video-prism-2pass'}}])
})

test('settings: a setting back to its default takes the key out of config.json; leaving with a change asks first', async ({page}) => {
  await page.goto(`${base}/p/music/demo/settings`)
  await page.getByLabel('Video size').fill('-1')
  await expect(page.getByLabel('Video size')).toHaveValue('-1')
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await dialog(page).getByRole('button', {name: 'Save it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'config' && !(p.body as {dryRun?: boolean}).dryRun)?.body).toEqual({change: {videoResolution: null}})
  // saved and read again: only then is the form free, and a change of it is a new one
  await expect(page.getByText('The settings are saved')).toBeVisible()
  await page.getByLabel('Black or frozen retries').fill('2')
  await page.getByRole('navigation', {name: 'Project'}).getByRole('link', {name: 'Timeline'}).click()
  await expect(dialog(page)).toContainText('changes to the settings')
})

test('settings: the finish field by field - its fields are locked while it is off, a step of their own (#809)', async ({page}) => {
  await page.goto(`${base}/p/music/demo/settings`)
  await expect(page.getByLabel('Film grain')).toHaveValue('3')
  await expect(page.getByLabel('Sharpen')).toHaveAttribute('step', '0.05')
  await page.getByLabel('Film grain').fill('2.5')
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'config')?.body).toEqual({change: {'finish.grain': 2.5}, dryRun: true})
  await dialog(page).getByRole('button', {name: 'Cancel'}).click()
  await page.getByLabel('Finish', {exact: true}).selectOption('off')
  await expect(page.getByLabel('Film grain')).toBeDisabled()
  await expect(page.getByLabel('Sharpen')).toBeDisabled()
})

test('refinish: the question says what the finish does, as the settings have it, and leads to them (#809)', async ({page}) => {
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('button', {name: 'Refinish'}).click()
  await expect(dialog(page)).toContainText('The finish: grade, sharpen 0.4, grain 3.')
  await dialog(page).getByRole('link', {name: 'Change it on Settings'}).click()
  await expect(page).toHaveURL(/\/p\/music\/demo\/settings$/)
  await expect(dialog(page)).toHaveCount(0)
})

test('timing: a first word that starts before its singing is said, tightened with one click, and a clip that does not know the move is named', async ({
  page,
}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  // the first word starts at 1 s, the singing at 1.4 s
  await expect(page.getByText('starts 0.4 s early')).toBeVisible()
  await expect(page.locator('.tline-row').first().getByText('early 0.4 s')).toBeVisible()
  // the clip whose prompt has the old times of the line, with the line, and what a plan run does
  await expect(page.locator('.detail')).toContainText('1 clip still has the old times of a moved line in its prompt: clip-1 (Hello night)')
  await expect(page.locator('.tline-row').first().getByText('prompt old')).toBeVisible()
  // the filters hold what is early, and what is old
  await page.getByRole('button', {name: 'Early starts (1)'}).click()
  await expect(page.locator('.tline-row')).toHaveCount(1)
  await page.getByRole('button', {name: 'Prompt old (1)'}).click()
  await expect(page.locator('.tline-row')).toHaveCount(1)
  // tightened: the start is where the singing begins, the line is a moved one, and nothing is early any more
  await page.getByRole('button', {name: 'Tighten the start', exact: true}).first().click()
  await expect(page.getByText('starts 0.4 s early')).toHaveCount(0)
  await expect(page.getByText('1 line moved')).toBeVisible()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          words: [
            {start: 1.4, end: 2, estimated: true},
            {start: 2, end: 3},
          ],
        },
      ],
    })
})

test('timeline: the clips that are not rendered are marked and rendered with one button, asked first', async ({page}) => {
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('button', {name: 'Render missing (1)'}).click()
  await expect(page.getByText('1 marked')).toBeVisible()
  await expect(dialog(page)).toContainText('clip-2')
  await dialog(page).getByRole('button', {name: 'Render them'}).click()
  await expect.poll(() => posted.at(-1)?.body).toEqual({action: {type: 'clips', ids: ['clip-2'], again: false}, servers: ['gpu']})
})

test('timeline: every clip can be rendered again in one go, asked first', async ({page}) => {
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('button', {name: 'Render all again (2)'}).click()
  await expect(page.getByText('2 marked')).toBeVisible()
  await dialog(page).getByRole('button', {name: 'Render them'}).click()
  await expect.poll(() => posted.at(-1)?.body).toEqual({action: {type: 'clips', ids: ['clip-1', 'clip-2'], again: true}, servers: ['gpu']})
})

test('timing: range editing exposes reversible split and review controls without destructive cut clearing', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  await page.locator('.tline-row').first().click()
  await expect(page.getByRole('button', {name: 'Clear the cut', exact: true})).toHaveCount(0)
  await expect(page.getByRole('button', {name: 'Mark reviewed', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Group selection', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Collapse group', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Undo', exact: true}).click()
  await page.getByRole('button', {name: 'Redo', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Collapse group', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Collapse group', exact: true}).click()
  await expect(page.locator('.tword')).toHaveCount(1)
  await page.getByRole('button', {name: 'Expand group', exact: true}).click()
  await expect(page.locator('.tword')).toHaveCount(2)
})

test('timing: split, join and redo preserve the audible word and send structural data', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  await page
    .locator('.tword')
    .first()
    .click({position: {x: 15, y: 30}})
  await expect(page.getByText('1 word selected', {exact: true})).toBeVisible()
  await page.getByText('Fit, split and shared boundary', {exact: true}).click()
  await page.getByLabel('Split after character', {exact: true}).fill('2')
  await page.getByLabel('Split time', {exact: true}).fill('1.5')
  await page.getByRole('button', {name: 'Split word', exact: true}).click()
  await expect(page.locator('.tword')).toHaveCount(3)
  await page.getByRole('button', {name: 'Join parts', exact: true}).click()
  await expect(page.locator('.tword')).toHaveCount(2)
  await page.getByRole('button', {name: 'Undo', exact: true}).click()
  await expect(page.locator('.tword')).toHaveCount(3)
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          words: [
            {text: 'He', start: 1, end: 1.5},
            {text: 'llo', joined: true, start: 1.5, end: 2},
            {text: 'night', start: 2, end: 3},
          ],
        },
      ],
    })
})

test('timing: fit previews a passage, keeps it unchecked and can undo in one step', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  await page.getByText('Fit, split and shared boundary', {exact: true}).click()
  await page.getByLabel('Fit start', {exact: true}).fill('3')
  await page.getByLabel('Fit end', {exact: true}).fill('7')
  await page.getByRole('button', {name: 'Preview fit', exact: true}).click()
  await expect(page.getByText(/Preview \(anchors stay fixed\)/)).toContainText('Hello 3.00–5.00')
  await page.getByRole('button', {name: 'Apply fit', exact: true}).click()
  await expect(page.locator('.tword').first()).toHaveAttribute('title', /0:03.*0:05/)
  await expect(page.locator('.tedit-head')).toContainText('estimated')
  await page.getByRole('button', {name: 'Undo', exact: true}).click()
  await expect(page.locator('.tword').first()).toHaveAttribute('title', /0:01.*0:02/)
  await page.screenshot({path: 'test-results/timing-editor.png', fullPage: true})
})

test('timing: shift-select words and move them together without losing the gap', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  await page
    .locator('.tword')
    .first()
    .click({position: {x: 15, y: 30}})
  await page
    .locator('.tword')
    .nth(1)
    .click({modifiers: ['Shift'], position: {x: 15, y: 30}})
  await expect(page.getByText('2 words selected', {exact: true})).toBeVisible()
  await page.locator('.tedit').press('Shift+ArrowRight')
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          words: [
            {start: 1.5, end: 2.5},
            {start: 2.5, end: 3.5},
          ],
        },
      ],
    })
})

test('timing: the whole-line bar moves every word and keeps the viewport still during dragging', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  await page
    .locator('.tword')
    .first()
    .click({position: {x: 15, y: 30}})
  const bar = await page.locator('.tline').boundingBox()
  const cutBefore = await page
    .locator('.tcut')
    .first()
    .evaluate(e => e.getBoundingClientRect().x)
  await page.mouse.move(bar!.x + 20, bar!.y + 8)
  await page.mouse.down()
  await page.mouse.move(bar!.x + 55, bar!.y + 8, {steps: 5})
  expect(
    await page
      .locator('.tcut')
      .first()
      .evaluate(e => e.getBoundingClientRect().x),
  ).toBeCloseTo(cutBefore, 1)
  await page.mouse.up()
  await expect(page.getByText('2 words selected', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  const body = posted.find(p => p.path === 'timing')?.body as {lines: {words: {start: number; end: number}[]}[]}
  const words = body.lines[0]!.words
  expect(words[0]!.start).toBeGreaterThan(1)
  expect(words[1]!.start - words[0]!.start).toBeCloseTo(1, 2)
  expect(words[0]!.end).toBeCloseTo(words[1]!.start, 2)
})

test('timing: listening marks exactly one onset per key, pauses and applies an offset', async ({page}) => {
  await page.addInitScript(() => {
    class FakeAudio {
      dataset: Record<string, string> = {}
      currentTime = 0
      paused = true
      ended = false
      playbackRate = 1
      preservesPitch = true
      constructor(_src: string) {
        ;(window as unknown as {testAudio: FakeAudio}).testAudio = this
      }
      play() {
        this.paused = false
        return Promise.resolve()
      }
      pause() {
        this.paused = true
      }
    }
    window.Audio = FakeAudio as unknown as typeof Audio
  })
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
                  section: 'Verse',
                  text: 'Hello night',
                  words: [
                    {text: 'Hello', start: 1, end: 2},
                    {text: 'night', start: 2, end: 3},
                  ],
                  estimated: true,
                  byHand: false,
                  beats: [],
                },
              ],
              cuts: [{id: 'clip-1', start: 0, end: 10}],
              beats: [],
              unplanned: [],
              outdated: [],
              audio: {file: 'vocals.wav', v: 1},
            },
          },
        }),
  )
  await page.goto(`${base}/p/music/demo/timing`)
  await page.getByText('Listen and mark onsets', {exact: true}).click()
  await page.getByRole('button', {name: 'Start marking', exact: true}).click()
  const time = (t: number) =>
    page.evaluate(t => {
      ;(window as unknown as {testAudio: {currentTime: number}}).testAudio.currentTime = t
    }, t)
  await time(1.2)
  await page.keyboard.press('m')
  await expect(page.getByRole('status')).toContainText('1/3 marks')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible()
  await page.keyboard.press('Space')
  await time(2.2)
  await page.keyboard.press('m')
  await time(3.2)
  await page.keyboard.press('m')
  await page.getByLabel('Reaction offset (ms)').fill('200')
  await page.getByRole('button', {name: 'Apply marks', exact: true}).click()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect
    .poll(() => posted.find(p => p.path === 'timing')?.body)
    .toMatchObject({
      lines: [
        {
          line: 0,
          words: [
            {start: 1, end: 2, anchor: true, estimated: true},
            {start: 2, end: 3, anchor: true, estimated: true},
          ],
        },
      ],
    })
})

// the step that is open on the Post-work page: its form is on the page, not in a question
const step = (page: Page) => page.locator('.pw-step.open')

test('post-work: the AI marker is put on a finished video, from the settings of the project, changed in the form', async ({page}) => {
  // its own stub: a project with a final video and its finished copy
  await page.unrouteAll()
  posted = await stubProject(page, 'music', {
    final: {state: 'current', file: 'demo.mp4', v: 1},
    finals: [
      {file: 'demo.mp4', v: 1, label: 'Final', state: 'current', preview: false},
      {file: 'demo-finished.mp4', v: 1, label: 'Final finished', state: 'current', preview: false},
    ],
  })
  // from the timeline: one way to the page, the four questions are gone from it
  await page.goto(`${base}/p/music/demo/`)
  await expect(page.getByRole('button', {name: 'AI marker'})).toHaveCount(0)
  await page.getByRole('link', {name: 'Post-work'}).first().click()
  await expect(page).toHaveURL(/\/p\/music\/demo\/postwork$/)
  // the first step is open: the finished video by default, and what the project has set
  await expect(step(page)).toContainText('AI marker')
  await expect(step(page).getByLabel('From')).toHaveValue('demo-finished.mp4')
  await expect(step(page).getByLabel('Marker')).toHaveValue('generated-white50')
  await step(page).getByLabel('When').selectOption('interval')
  await step(page).getByLabel('Every (seconds)').fill('30')
  await step(page).getByLabel('Marker').selectOption('basic-black')
  await step(page)
    .getByRole('checkbox', {name: /Keep these settings/})
    .check()
  await step(page).getByRole('button', {name: 'Put it on'}).click()
  await expect
    .poll(() => posted.at(-1)?.body)
    .toEqual({
      action: {
        type: 'label',
        from: 'demo-finished.mp4',
        marker: 'basic-black',
        mode: 'interval',
        seconds: 5,
        interval: 30,
        corner: 'top-right',
        size: 6,
        margin: 3,
        save: true,
      },
    })
})

test('post-work: the steps chain - each starts from what the step before wrote - and an intro is kept for every project', async ({page}) => {
  await page.unrouteAll()
  posted = await stubProject(page, 'music', {
    final: {state: 'current', file: 'demo.mp4', v: 1},
    finals: [
      {file: 'demo.mp4', v: 1, label: 'Final', state: 'current', preview: false},
      {file: 'demo-labeled.mp4', v: 1, label: 'Final + AI label', state: 'current', preview: false, postwork: true},
      {file: 'demo-labeled-credits.mp4', v: 1, label: 'Final + AI label + credits', state: 'current', preview: false, postwork: true},
    ],
  })
  await page.goto(`${base}/p/music/demo/postwork`)
  // marker and credits are made: the intro is open, from the credits' video
  await expect(step(page)).toContainText('Intro')
  await expect(step(page).getByLabel('From')).toHaveValue('demo-labeled-credits.mp4')
  // the credits start from the marker's video
  await page.getByRole('button', {name: /Title card and credits/}).click()
  await expect(step(page).getByLabel('From')).toHaveValue('demo-labeled.mp4')
  await page.getByRole('button', {name: /^3 Intro/}).click()
  await expect(step(page).getByLabel(/Intro \(path/)).toHaveAttribute('placeholder', 'input/intro.mp4 of this project')
  await step(page)
    .getByLabel(/Intro \(path/)
    .fill('D:/videos/channel.mp4')
  await step(page).getByLabel(/Fade/).fill('0.5')
  await step(page)
    .getByRole('checkbox', {name: /every project/})
    .check()
  await step(page).getByRole('button', {name: 'Put it in front'}).click()
  await expect
    .poll(() => posted.at(-1)?.body)
    .toEqual({action: {type: 'intro', from: 'demo-labeled-credits.mp4', file: 'D:/videos/channel.mp4', fade: 0.5, saveDefault: true}})
})

test('post-work: a title card and credits are added to a finished video, with the lines of the project and its artist', async ({page}) => {
  await page.unrouteAll()
  posted = await stubProject(page, 'music', {
    final: {state: 'current', file: 'demo.mp4', v: 1},
    finals: [{file: 'demo.mp4', v: 1, label: 'Final', state: 'current', preview: false}],
  })
  await page.goto(`${base}/p/music/demo/postwork`)
  await page.getByRole('button', {name: /Title card and credits/}).click()
  await expect(step(page).getByLabel('Artist (by …)')).toHaveValue('Klemens')
  await expect(step(page).getByLabel(/Lines of your own/)).toHaveValue('Thanks to the band')
  await step(page).getByLabel("Title (empty: the project's)").fill('Demo Song')
  await step(page)
    .getByLabel(/Lines of your own/)
    .fill('Thanks to the band\n\nfeverslop.example')
  await step(page).getByLabel('Marker on the title card').selectOption('generated-white')
  await step(page)
    .getByRole('checkbox', {name: /this project/})
    .check()
  await step(page).getByRole('button', {name: 'Add them'}).click()
  await expect
    .poll(() => posted.at(-1)?.body)
    .toEqual({
      action: {
        type: 'credits',
        from: 'demo.mp4',
        opening: true,
        end: true,
        openingSeconds: 4,
        endSeconds: 0,
        title: 'Demo Song',
        artist: 'Klemens',
        disclosure: 'Contains AI-generated content',
        marker: 'generated-white',
        extra: ['Thanks to the band', 'feverslop.example'],
        hardware: '',
        facts: true,
        sound: '',
        save: true,
      },
    })
})

test('post-work: what the steps made plays on the page, never by itself, with its YouTube text - and not on the timeline', async ({page}) => {
  await page.unrouteAll()
  posted = await stubProject(page, 'music', {
    final: {state: 'current', file: 'demo.mp4', v: 1},
    finals: [
      {file: 'demo.mp4', v: 1, label: 'Final', state: 'current', preview: false},
      {file: 'demo-labeled.mp4', v: 1, label: 'Final + AI label', state: 'current', preview: false, postwork: true, youtube: 'Demo Song\n\nMade with AI.'},
    ],
  })
  await page.goto(`${base}/p/music/demo/postwork`)
  await expect(page.getByRole('listbox', {name: 'What the steps made'}).getByRole('option', {name: /Final \+ AI label/})).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const video = page.locator('.pw-video')
  await expect(video).toHaveAttribute('src', /demo-labeled\.mp4/)
  expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay || !v.paused)).toBe(false)
  await expect(page.locator('.pw-text pre')).toHaveText('Demo Song\n\nMade with AI.')
  // the YouTube text takes the newest video of the steps
  await page.getByRole('button', {name: /YouTube text/}).click()
  await expect(step(page).getByLabel('The video you publish')).toHaveValue('demo-labeled.mp4')
  // the timeline's video choice has the music video, not what a step made
  await page.getByRole('navigation', {name: 'Project'}).getByRole('link', {name: 'Timeline'}).click()
  const choice = page.getByLabel('What the monitor plays')
  await expect(choice.locator('option', {hasText: 'Final'})).toHaveCount(1)
  await expect(choice.locator('option', {hasText: 'AI label'})).toHaveCount(0)
})

test('timeline: R renders the clip at the playhead again, asked first - a key of the help works in capitals too', async ({page}) => {
  await page.goto(`${base}/p/music/demo/#clip-1`)
  await expect(page.locator('.ihead h2')).toContainText('clip-1')
  await page.keyboard.press('Shift+R')
  await expect(dialog(page)).toContainText('Render clip-1')
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect.poll(() => posted.find(p => p.path === 'run')?.body).toMatchObject({action: {type: 'clips', ids: ['clip-1']}})
})

test('the tabs by phase: Plan, Shoot and Publish named, the state of a tab in words, every tab in the bar at 1100 and 1600 px (#941)', async ({page}) => {
  for (const [kind, plan] of [
    ['music', ['Story', 'Casting', 'Singers', 'Timing', 'Look']],
    ['film', ['Screenplay', 'Casting', 'Look']],
  ] as const) {
    await stubProject(page, kind)
    for (const width of [1100, 1600]) {
      await page.setViewportSize({width, height: 800})
      await page.goto(`${base}/p/${kind}/demo/story`)
      const nav = page.getByRole('navigation', {name: 'Project'})
      const tabs = (group: string) => nav.getByRole('group', {name: group}).getByRole('link')
      await expect(tabs('Plan')).toHaveText(plan.map(name => new RegExp(`^${name}`)))
      await expect(tabs('Shoot')).toHaveText([/^References/, /^Timeline/, /^Direction/])
      await expect(tabs('Publish')).toHaveText([/^Post-work/])
      await expect(nav.getByText('Plan', {exact: true})).toBeVisible()
      // the state in words, not only as a mark or in a title
      await expect(nav.getByRole('link', {name: 'Casting (planned)', exact: true})).toBeVisible()
      // no tab cut off: the last one ends inside the bar
      const bar = (await nav.boundingBox())!
      const last = (await nav.getByRole('link', {name: 'Settings'}).boundingBox())!
      expect(last.x + last.width).toBeLessThanOrEqual(bar.x + bar.width + 1)
      // one bar of stages: the tabs carry them, no second one
      await expect(page.locator('.stagebar, .stage-bar')).toHaveCount(0)
    }
  }
})

test('run dock: a lost line to the workspace is said with the time of the last word - the run is not failed - and goes when it is back (#935)', async ({
  page,
}) => {
  const running = {source: 'terminal', command: 'bun index.ts demo', pid: 1, startedAt: '2026-11-03T00:00:00Z', running: true}
  let away = false
  await page.route(/\/p\/music\/demo\/api\/run-events/, route =>
    away
      ? route.abort('connectionrefused')
      : route.fulfill({status: 200, headers: {'Content-Type': 'text/event-stream'}, body: `retry: 300\nevent: state\ndata: ${JSON.stringify(running)}\n\n`}),
  )
  await page.goto(`${base}/p/music/demo/`)
  const dock = page.getByRole('region', {name: 'Run'})
  await expect(dock).toContainText('Running in the terminal')
  away = true
  await expect(dock.getByRole('status')).toContainText(/No connection to the workspace since .* the run may have gone on or ended meanwhile/)
  await expect(dock).toContainText('Running in the terminal')
  await expect(dock).not.toContainText('Failed')
  away = false
  await expect(dock.getByRole('status')).toHaveCount(0)
})

test('a later read of the project that fails keeps the page and what was typed, says it may be old, and is read again (#936)', async ({page}) => {
  // a run goes on, then ends: the page reads the project again - and that read fails
  let connections = 0
  const running = {source: 'terminal', command: 'bun index.ts demo', pid: 1, startedAt: '2026-11-03T00:00:00Z', running: true}
  let ended = false
  await page.route(/\/p\/music\/demo\/api\/run-events/, route => {
    const state = connections++ && ended ? {...running, running: false, code: 0} : running
    return route.fulfill({status: 200, headers: {'Content-Type': 'text/event-stream'}, body: `retry: 100\nevent: state\ndata: ${JSON.stringify(state)}\n\n`})
  })
  let failing = false
  await page.route(/\/p\/music\/demo\/api\/project$/, route =>
    failing ? route.fulfill({status: 500, json: {error: 'the disk is gone', kind: 'failed'}}) : route.fallback(),
  )
  await page.goto(`${base}/p/music/demo/story`)
  const text = page.getByRole('textbox', {name: 'Story'})
  await expect(text).toHaveValue('Once upon a time')
  await text.fill('Once upon a night')
  failing = true
  ended = true
  const notice = page.getByRole('alert').filter({hasText: 'may be out of date'})
  await expect(notice).toContainText('the disk is gone')
  await expect(text).toHaveValue('Once upon a night')
  failing = false
  await notice.getByRole('button', {name: 'Retry'}).click()
  await expect(notice).toHaveCount(0)
  await expect(text).toHaveValue('Once upon a night')
})

test('timeline: a read at the end of a run that fails is said once, above the page - not again as a toast (#936)', async ({page}) => {
  let connections = 0
  const running = {source: 'terminal', command: 'bun index.ts demo', pid: 1, startedAt: '2026-11-03T00:00:00Z', running: true}
  let ended = false
  await page.route(/\/p\/music\/demo\/api\/run-events/, route => {
    const state = connections++ && ended ? {...running, running: false, code: 0} : running
    return route.fulfill({status: 200, headers: {'Content-Type': 'text/event-stream'}, body: `retry: 100\nevent: state\ndata: ${JSON.stringify(state)}\n\n`})
  })
  let failing = false
  await page.route(/\/p\/music\/demo\/api\/project$/, route =>
    failing ? route.fulfill({status: 500, json: {error: 'the disk is gone', kind: 'failed'}}) : route.fallback(),
  )
  await page.goto(`${base}/p/music/demo/`)
  await expect(page.getByRole('heading', {name: 'Demo song'})).toBeVisible()
  failing = true
  ended = true
  await expect(page.getByRole('alert').filter({hasText: 'may be out of date'})).toContainText('the disk is gone')
  await expect(page.getByRole('status').filter({hasText: 'the disk is gone'})).toHaveCount(0)
})
