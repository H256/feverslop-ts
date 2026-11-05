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
  // a link to a clip on the open page: the playhead goes there
  await page.evaluate(() => { location.hash = 'clip-1' })
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
  await expect(dialog(page)).toContainText('What is built on the story goes: summary.')
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
  await expect.poll(() => posted.find(p => p.path === 'cast')?.body).toEqual({characters: [{id: 'ann', name: 'Ann', role: 'singer'}], locations: [{id: 'bar', name: 'Bar'}, {name: 'Roof'}]})
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
  await expect.poll(() => filmPosted.find(p => p.path === 'run')?.body).toMatchObject({action: {type: 'adapt-story', add: [{name: 'Kai', role: 'the night porter'}], remove: ['bo']}})
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
    await new Promise<void>(resolve => { release = resolve })
    await route.fallback()
  })
  await page.goto(`${base}/p/music/demo/singers#line-0`)
  await page.getByLabel('Add a singer').selectOption('ben')
  await page.locator('#line-0').press('2')
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  await expect(page.locator('.split.view')).toHaveAttribute('inert', '')
  release()
  await expect(page.locator('.split.view')).not.toHaveAttribute('inert', '')
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
  await dialog(page).getByLabel('Picture').setInputFiles({name: 'kael.png', mimeType: 'image/png', buffer: Buffer.from('png')})
  await dialog(page).getByLabel('Library id').fill('kael')
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect(dialog(page).getByRole('alert')).toHaveText('library:kael already exists')
  await expect(dialog(page).getByLabel('Library id')).toHaveValue('kael')
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
    await new Promise<void>(resolve => { answer = resolve })
    await route.fulfill({json: {run: {source: 'here', command: 'bun tools/create-asset.ts kael', pid: 9, startedAt: '2026-11-03T00:00:00Z', running: true}}})
  })
  await page.route('**/api/library/run-events*', route => route.fulfill({status: 200, headers: {'Content-Type': 'text/event-stream'}, body: 'event: state\ndata: null\n\n'}))
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('navigation', {name: 'Workspace'}).getByRole('link', {name: 'Library'}).click()
  await page.getByRole('button', {name: 'New asset from a picture'}).click()
  await dialog(page).getByLabel('Picture').setInputFiles({name: 'kael.png', mimeType: 'image/png', buffer: Buffer.from('png')})
  await dialog(page).getByRole('button', {name: 'Render it'}).click()
  await expect(dialog(page).getByRole('button', {name: 'Working…'})).toBeVisible()
  await page.goBack()
  await expect(page.locator('.ihead h2')).toContainText('clip-1')
  // the project follows its runs; a late answer of the library must not start that over from the start (after=0) for its run
  const reconnects: string[] = []
  page.on('request', request => { if (request.url().includes('/p/music/demo/api/run-events')) reconnects.push(request.url()) })
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
  await expect.poll(() => posted.filter(p => p.path === 'config').map(p => p.body)).toEqual([
    {change: {videoWorkflow: 'h3-ref2video-prism-2pass'}, dryRun: true},
    {change: {videoWorkflow: 'h3-ref2video-prism-2pass'}},
  ])
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

test('timing: a first word that starts before its singing is said, tightened with one click, and a clip that does not know the move is named', async ({page}) => {
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
  await expect.poll(() => posted.find(p => p.path === 'timing')?.body).toEqual({lines: [{line: 0, words: [{start: 1.4, end: 2}, {start: 2, end: 3}]}]})
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
  await page.getByRole('button', {name: 'Render all (2)'}).click()
  await expect(page.getByText('2 marked')).toBeVisible()
  await dialog(page).getByRole('button', {name: 'Render them'}).click()
  await expect.poll(() => posted.at(-1)?.body).toEqual({action: {type: 'clips', ids: ['clip-1', 'clip-2'], again: true}, servers: ['gpu']})
})

test('timing: a clip cut inside a word is cleared with one click, and the next problem key goes to the line that wants a look', async ({page}) => {
  await page.goto(`${base}/p/music/demo/timing`)
  await page.locator('.tline-row').first().click()
  // moved by 3.5 s: the cut at 5 s falls into the second word
  for (let n = 0; n < 7; n++) await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.warn').first()).toContainText('A clip cut falls into "')
  await page.getByRole('button', {name: 'Clear the cut'}).click()
  await expect(page.locator('.warn', {hasText: 'A clip cut falls'})).toHaveCount(0)
  // one undo brings the cut back
  await page.getByRole('button', {name: 'Undo'}).click()
  await expect(page.locator('.warn', {hasText: 'A clip cut falls'}).first()).toBeVisible()
  // the key N picks the next line that wants a look; the button says how many there are
  await expect(page.getByRole('button', {name: /Next problem \(\d+\)/})).toBeVisible()
  await page.locator('.tedit').focus()
  await page.keyboard.press('n')
  await expect(page.locator('.tedit-head b')).toBeVisible()
})

test('timeline: the AI marker is put on a finished video, from the settings of the project, changed in the question', async ({page}) => {
  // its own stub: a project with a final video and its finished copy
  await page.unrouteAll()
  posted = await stubProject(page, 'music', {
    final: {state: 'current', file: 'demo.mp4', v: 1},
    finals: [{file: 'demo.mp4', v: 1, label: 'Final', state: 'current', preview: false}, {file: 'demo-finished.mp4', v: 1, label: 'Final finished', state: 'current', preview: false}],
  })
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('button', {name: 'AI marker'}).click()
  // the finished video by default, and what the project has set
  await expect(dialog(page).getByLabel('From')).toHaveValue('demo-finished.mp4')
  await expect(dialog(page).getByLabel('Marker')).toHaveValue('generated-white50')
  // no render servers: it runs on this machine
  await expect(dialog(page).getByRole('checkbox', {name: /gpu/})).toHaveCount(0)
  await dialog(page).getByLabel('When').selectOption('interval')
  await dialog(page).getByLabel('Every (seconds)').fill('30')
  await dialog(page).getByLabel('Marker').selectOption('basic-black')
  await dialog(page).getByRole('checkbox', {name: /Keep these settings/}).check()
  await dialog(page).getByRole('button', {name: 'Put it on'}).click()
  await expect.poll(() => posted.at(-1)?.body).toEqual({action: {
    type: 'label', from: 'demo-finished.mp4', marker: 'basic-black', mode: 'interval', seconds: 5, interval: 30, corner: 'top-right', size: 6, margin: 3, save: true,
  }})
})

test('timeline: an intro is put in front of a finished video - input/intro.mp4 of the project, or a path - and kept for every project', async ({page}) => {
  await page.unrouteAll()
  posted = await stubProject(page, {
    final: {state: 'current', file: 'demo.mp4', v: 1},
    finals: [{file: 'demo.mp4', v: 1, label: 'Final', state: 'current', preview: false}, {file: 'demo-labeled.mp4', v: 1, label: 'Final + AI label', state: 'current', preview: false}],
  })
  await page.goto(`${base}/p/music/demo/`)
  await page.getByRole('button', {name: 'Intro', exact: true}).click()
  await expect(dialog(page).getByLabel('From')).toHaveValue('demo.mp4')
  // the intro of the project is offered without a path
  await expect(dialog(page).getByLabel(/Intro \(path/)).toHaveAttribute('placeholder', 'input/intro.mp4 of this project')
  await dialog(page).getByLabel('From').selectOption('demo-labeled.mp4')
  await dialog(page).getByLabel(/Intro \(path/).fill('D:/videos/channel.mp4')
  await dialog(page).getByLabel(/Fade/).fill('0.5')
  await dialog(page).getByRole('checkbox', {name: /every project/}).check()
  await dialog(page).getByRole('button', {name: 'Put it in front'}).click()
  await expect.poll(() => posted.at(-1)?.body).toEqual({action: {type: 'intro', from: 'demo-labeled.mp4', file: 'D:/videos/channel.mp4', fade: 0.5, saveDefault: true}})
})
