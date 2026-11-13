import {test, expect} from '@playwright/test'
import {startEditor} from './editor'
import {project, stubProject} from './fixtures'
import type {DirectionView} from '../../../shared/direction'

let editor: Awaited<ReturnType<typeof startEditor>>
test.beforeAll(async () => {
  editor = await startEditor()
})
test.afterAll(async () => {
  await editor?.stop()
})

function view(): DirectionView {
  return {
    rules: [],
    edits: [],
    editIssues: [],
    shots: [{id: 'b1:shot1', groupId: 'b1', characters: ['ann'], start: 0, end: 4, data: {action: 'Ann turns right'}}],
    characters: [{id: 'ann', name: 'Ann'}],
    groups: [{id: 'b1', label: 'Ann arrives'}],
    unresolved: [],
    versions: [],
    pending: false,
    restored: false,
  }
}

test('direction: save a scoped instruction, edit it, and run the CLI preview', async ({page}) => {
  const posted = await stubProject(page)
  let state = view()
  await page.route('**/api/direction', async route => {
    if (route.request().method() === 'POST') {
      state = {...state, ...route.request().postDataJSON(), pending: true}
    }
    await route.fulfill({json: state})
  })
  await page.goto(`${editor.base}/p/music/demo/direction?shot=b1%3Ashot1`)
  await expect(page.getByRole('heading', {name: 'Direction', exact: true})).toBeVisible()
  await expect(page.getByRole('combobox', {name: 'Scope', exact: true})).toHaveValue('shot')
  await page.getByLabel('Instruction', {exact: true}).fill('Ann turns to her own left, ending with her back to the camera.')
  await page.getByRole('button', {name: 'Save instruction', exact: true}).click()
  await expect.poll(() => state.rules.length).toBe(1)
  expect(state.rules[0]?.scope).toEqual({kind: 'shot', id: 'b1:shot1'})
  await page.getByRole('button', {name: 'Edit instruction', exact: true}).click()
  await page.getByLabel('Instruction', {exact: true}).fill('Ann turns to her own left.')
  await page.getByRole('button', {name: 'Save instruction', exact: true}).click()
  await expect.poll(() => state.rules[0]?.text).toBe('Ann turns to her own left.')
  await page.getByRole('button', {name: 'Preview changes', exact: true}).click()
  await expect.poll(() => posted.find(p => p.path === 'run')?.body).toMatchObject({action: {type: 'direction'}})
})

test('direction: proposal conflicts are shown, taken only as Take anyway; drop remains available', async ({page}) => {
  await stubProject(page)
  const state = view()
  state.rules = [{id: 'r', text: 'Turn left', scope: {kind: 'global'}}]
  state.proposal = {
    id: 'p',
    sourceFingerprint: 'source',
    rulesFingerprint: 'rules',
    changes: [{shotId: 'b1:shot1', before: {action: 'Ann turns right'}, after: {action: 'Ann turns left'}}],
    conflicts: ['Next shot starts facing the wrong way.'],
  }
  let dropped = false
  await page.route('**/api/direction**', async route => {
    if (route.request().url().endsWith('/drop')) {
      dropped = true
      delete state.proposal
    }
    await route.fulfill({json: state})
  })
  await page.goto(`${editor.base}/p/music/demo/direction`)
  await expect(page.getByText('Ann turns right', {exact: false})).toBeVisible()
  await expect(page.getByText('Next shot starts facing the wrong way.')).toBeVisible()
  await expect(page.getByRole('button', {name: 'Take changes', exact: true})).toHaveCount(0)
  await expect(page.getByRole('button', {name: 'Take anyway', exact: true})).toBeEnabled()
  await page.getByRole('button', {name: 'Drop proposal', exact: true}).click()
  await expect.poll(() => dropped).toBe(true)
})

test('direction in the timeline: the cast lane, the shot dialog, a person taken out of the shot by code', async ({page}) => {
  const shot = {
    label: '[Shot 1]',
    at: 0,
    framing: 'wide',
    camera: 'static',
    subjects: ['ann'],
    people: [],
    directionId: 'b1:shot1',
    cast: [
      {id: 'ann', name: 'Ann', does: ['sings' as const]},
      {id: 'bob', name: 'Bob', does: []},
    ],
  }
  const posted = await stubProject(page, 'music', {clips: project.clips.map(c => ({...c, shots: [shot]}))})
  let state: DirectionView = {
    ...view(),
    characters: [
      {id: 'ann', name: 'Ann'},
      {id: 'bob', name: 'Bob'},
    ],
    shots: [
      {
        id: 'b1:shot1',
        groupId: 'b1',
        characters: ['ann', 'bob'],
        start: 0,
        end: 5,
        data: {
          action: '{Ann} sings while {Bob} leans on the bar',
          framing: 'wide shot',
          people: {ann: {singing: true, state: 'stands at the bar'}, bob: {state: 'leans on the bar'}},
        },
      },
    ],
  }
  await page.route('**/api/direction', route => route.fulfill({json: state}))
  await page.route('**/api/direction/edits', async route => {
    state = {...state, edits: route.request().postDataJSON().edits}
    await route.fulfill({json: state})
  })
  // people out of the shot and the run that follows: one request (#830)
  let people: unknown
  await page.route('**/api/direction/people', async route => {
    people = route.request().postDataJSON()
    state = {...state, edits: [{id: 'out', scope: {kind: 'shot', id: 'b1:shot1'}, remove: 'bob'}]}
    await route.fulfill({
      json: {...state, proposing: false, run: {source: 'here', command: 'bun index.ts demo', pid: 1, startedAt: new Date().toISOString(), running: true}},
    })
  })
  await page.goto(`${editor.base}/p/music/demo/`)
  // the cast lane: one per character, a click directs the shot under it
  await expect(page.locator('.labels .lane-cast', {hasText: 'Ann'})).toBeVisible()
  await page.locator('.lane.lane-cast .cast.sings').first().click()
  const dialog = page.getByRole('dialog', {name: 'Direct this shot'})
  await expect(dialog.getByRole('heading', {name: 'b1:shot1'})).toBeVisible()
  // tokens shown as names; whoever sings stays in the shot
  await expect(dialog.getByText('Ann sings while Bob leans on the bar')).toBeVisible()
  // marked first (#790), then taken out together
  const takeOut = dialog.getByRole('checkbox', {name: 'Take out'})
  await expect(takeOut.first()).toBeDisabled()
  await takeOut.nth(1).check()
  await dialog.getByRole('button', {name: 'Take Bob out of the shot'}).click()
  await expect.poll(() => people).toMatchObject({shotId: 'b1:shot1', remove: ['bob']})
  // the server built the clip prompts again in the same request: the page starts no run of its own
  await expect(dialog.getByRole('button', {name: 'Take Bob out of the shot'})).toBeHidden()
  expect(posted.find(p => p.path === 'run')).toBeUndefined()
})

test('a failure stays until closed or until the same action works - a notice does not take it away; reached by keyboard (#940)', async ({page}) => {
  await stubProject(page)
  let state = view()
  let refuse = true
  await page.route('**/api/direction', async route => {
    if (route.request().method() === 'POST') {
      if (refuse) return route.fulfill({status: 500, json: {error: 'the disk is full', kind: 'failed'}})
      state = {...state, ...route.request().postDataJSON(), pending: true}
    }
    await route.fulfill({json: state})
  })
  await page.goto(`${editor.base}/p/music/demo/direction?shot=b1%3Ashot1`)
  await page.getByLabel('Instruction', {exact: true}).fill('Ann turns to her own left.')
  await page.getByRole('button', {name: 'Save instruction', exact: true}).click()
  const failure = page.getByRole('alert').filter({hasText: 'the disk is full'})
  await expect(failure).toBeVisible()
  // long past the time a toast used to go
  await page.waitForTimeout(7500)
  await expect(failure).toBeVisible()
  await expect(failure.getByRole('button', {name: /^Close/})).toBeEnabled()
  // tried again and it works: the failure goes, the notice of the success comes
  refuse = false
  await page.getByRole('button', {name: 'Save instruction', exact: true}).click()
  await expect(page.getByRole('status').filter({hasText: 'Instruction saved'})).toBeVisible()
  await expect(failure).toHaveCount(0)
  // another failure: closed from the keyboard
  refuse = true
  await page.getByRole('button', {name: 'Edit instruction', exact: true}).click()
  await page.getByLabel('Instruction', {exact: true}).fill('Ann turns right.')
  await page.getByRole('button', {name: 'Save instruction', exact: true}).click()
  await expect(failure).toBeVisible()
  await failure.getByRole('button', {name: /^Close/}).focus()
  await page.keyboard.press('Enter')
  await expect(failure).toHaveCount(0)
})
