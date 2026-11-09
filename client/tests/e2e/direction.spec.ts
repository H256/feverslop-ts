import {test, expect} from '@playwright/test'
import {startEditor} from './editor'
import {project, stubProject} from './fixtures'
import type {DirectionView} from '../../../shared/direction'

let editor: Awaited<ReturnType<typeof startEditor>>
test.beforeAll(async () => { editor = await startEditor() })
test.afterAll(async () => { await editor?.stop() })

function view(): DirectionView {
  return {rules: [], edits: [], editIssues: [], shots: [{id: 'b1:shot1', groupId: 'b1', characters: ['ann'], start: 0, end: 4, data: {action: 'Ann turns right'}}], characters: [{id: 'ann', name: 'Ann'}], groups: [{id: 'b1', label: 'Ann arrives'}], unresolved: [], versions: [], pending: false, restored: false}
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

test('direction: proposal conflicts block take, drop remains available', async ({page}) => {
  await stubProject(page)
  const state = view()
  state.rules = [{id: 'r', text: 'Turn left', scope: {kind: 'global'}}]
  state.proposal = {id: 'p', sourceFingerprint: 'source', rulesFingerprint: 'rules', changes: [{shotId: 'b1:shot1', before: {action: 'Ann turns right'}, after: {action: 'Ann turns left'}}], conflicts: ['Next shot starts facing the wrong way.']}
  let dropped = false
  await page.route('**/api/direction**', async route => {
    if (route.request().url().endsWith('/drop')) { dropped = true; delete state.proposal }
    await route.fulfill({json: state})
  })
  await page.goto(`${editor.base}/p/music/demo/direction`)
  await expect(page.getByText('Ann turns right', {exact: false})).toBeVisible()
  await expect(page.getByText('Next shot starts facing the wrong way.')).toBeVisible()
  await expect(page.getByRole('button', {name: 'Take changes', exact: true})).toBeDisabled()
  await page.getByRole('button', {name: 'Drop proposal', exact: true}).click()
  await expect.poll(() => dropped).toBe(true)
})

test('direction in the timeline: the cast lane, the shot dialog, a person taken out of the shot by code', async ({page}) => {
  const shot = {label: '[Shot 1]', at: 0, framing: 'wide', camera: 'static', subjects: ['ann'], people: [], directionId: 'b1:shot1', cast: [{id: 'ann', name: 'Ann', does: ['sings' as const]}, {id: 'bob', name: 'Bob', does: []}]}
  const posted = await stubProject(page, 'music', {clips: project.clips.map(c => ({...c, shots: [shot]}))})
  let state: DirectionView = {...view(), characters: [{id: 'ann', name: 'Ann'}, {id: 'bob', name: 'Bob'}],
    shots: [{id: 'b1:shot1', groupId: 'b1', characters: ['ann', 'bob'], start: 0, end: 5, data: {action: '{Ann} sings while {Bob} leans on the bar', framing: 'wide shot', people: {ann: {singing: true, state: 'stands at the bar'}, bob: {state: 'leans on the bar'}}}}]}
  await page.route('**/api/direction', route => route.fulfill({json: state}))
  await page.route('**/api/direction/edits', async route => {
    state = {...state, edits: route.request().postDataJSON().edits}
    await route.fulfill({json: state})
  })
  await page.goto(`${editor.base}/p/music/demo/`)
  // the cast lane: one per character, a click directs the shot under it
  await expect(page.locator('.labels .lane-cast', {hasText: 'Ann'})).toBeVisible()
  await page.locator('.lane.lane-cast .cast.sings').first().click()
  const dialog = page.getByRole('dialog', {name: 'Direct this shot'})
  await expect(dialog.getByRole('heading', {name: 'b1:shot1'})).toBeVisible()
  // tokens shown as names; whoever sings stays in the shot
  await expect(dialog.getByText('Ann sings while Bob leans on the bar')).toBeVisible()
  const takeOut = dialog.getByRole('button', {name: 'Take out of the shot'})
  await expect(takeOut.first()).toBeDisabled()
  await takeOut.nth(1).click()
  await expect.poll(() => state.edits.map(e => [e.remove, e.scope])).toEqual([['bob', {kind: 'shot', id: 'b1:shot1'}]])
  // the clip prompts are built again at once
  await expect.poll(() => posted.find(p => p.path === 'run')?.body).toMatchObject({action: {type: 'plan'}})
})
