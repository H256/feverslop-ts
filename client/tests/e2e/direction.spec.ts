import {test, expect} from '@playwright/test'
import {startEditor} from './editor'
import {stubProject} from './fixtures'
import type {DirectionView} from '../../../shared/direction'

let editor: Awaited<ReturnType<typeof startEditor>>
test.beforeAll(async () => { editor = await startEditor() })
test.afterAll(async () => { await editor?.stop() })

function view(): DirectionView {
  return {rules: [], shots: [{id: 'b1:shot1', groupId: 'b1', characters: ['ann'], start: 0, end: 4, data: {action: 'Ann turns right'}}], characters: [{id: 'ann', name: 'Ann'}], groups: [{id: 'b1', label: 'Ann arrives'}], unresolved: [], versions: [], pending: false, restored: false}
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
