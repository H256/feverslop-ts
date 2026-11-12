import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {PROJECT_PAGES} from '../../../shared/workspace'

// #840: the pages of a project are listed once, in shared/workspace.ts. The server answers their addresses from that list; the
// router's routes and the layout's tabs are checked against it here - a page added in one place and forgotten in another
// was a 404 on reload, or a tab that led nowhere.
const source = (file: string) => readFileSync(fileURLToPath(new URL(`../../src/${file}`, import.meta.url)), 'utf8')

test('the router has a route for every page of a project, and no other', () => {
  const router = source('router.ts')
  // the routes are made from the list; the pages they load are a record of it, which the compiler holds to the list
  expect(router).toContain('...PROJECT_PAGES.map(page => ({path: page, name: page, component: PAGES[page]}))')
  const pages = router.split('const PAGES')[1]!.split('\n}')[0]!
  expect([...pages.matchAll(/^ {2}([a-z]+): \(\) => import/gm)].map(m => m[1]!).sort()).toEqual([...PROJECT_PAGES].sort())
  // the timeline is the project's own address
  expect(router).toContain("{path: '', name: 'timeline'")
})

test('the layout has a tab for every page', () => {
  const layout = source('features/project/ProjectLayout.vue')
  const paths = [...layout.matchAll(/path: '([a-z]*)'/g)].map(m => m[1]!)
  expect(paths.filter(Boolean).sort()).toEqual([...PROJECT_PAGES].sort())
})
