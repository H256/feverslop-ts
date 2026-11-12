import {describe, expect, test} from 'bun:test'
import type {DirectionView} from '../../../shared/direction'
import {describeShot, filterItems, groupItems, itemsOf, sameScope, shotDiff, shotGroup, shotNumber} from '../../src/features/direction/directionItems'

// #839: the list of the Direction page as plain functions
const name = (id: string) => ({kael: 'Kael', vey: 'Vey'})[id] ?? id
const view = {
  rules: [
    {id: 'r1', text: '{Kael} turns left', scope: {kind: 'shot', id: 'beat-02:shot2'}, characterId: 'kael'},
    {id: 'r2', text: 'slow pans', scope: {kind: 'global'}},
    {id: 'r3', text: 'in the plan', scope: {kind: 'beat', id: 'beat-01'}, planned: true},
    {id: 'r4', text: 'gone', scope: {kind: 'shot', id: 'beat-09:shot1'}, binding: {}},
  ],
  edits: [{id: 'e1', scope: {kind: 'shot', id: 'beat-02:shot1'}, remove: 'vey'}],
  editIssues: [],
  unresolved: [{ruleId: 'r4', message: 'the shot was planned again', stale: true}],
  groups: [
    {id: 'beat-01', label: 'The hall'},
    {id: 'beat-02', label: 'The door'},
  ],
} as unknown as DirectionView

describe('the items of the Direction page', () => {
  const items = itemsOf(view, name)
  test('every instruction and edit, with its issues and whether it is left over or for the planner', () => {
    expect(items.map(i => [i.key, i.text, i.planned, i.leftover, i.issues.length])).toEqual([
      ['r:r1', '{Kael} turns left', false, false, 0],
      ['r:r2', 'slow pans', false, false, 0],
      ['r:r3', 'in the plan', true, false, 0],
      ['r:r4', 'gone', false, true, 1],
      ['e:e1', 'Vey is not in the picture', false, false, 0],
    ])
  })
  test('filtered by words and by whom they are about - by id or by name in the text', () => {
    expect(filterItems(items, 'PANS', '', name).map(i => i.key)).toEqual(['r:r2'])
    expect(filterItems(items, '', 'vey', name).map(i => i.key)).toEqual(['e:e1'])
    expect(filterItems(items, '', 'kael', name).map(i => i.key)).toEqual(['r:r1'])
  })
  test('grouped: the whole video first, then beats in the order of the plan, shots in their order; leftovers apart', () => {
    const groups = groupItems(items, view, name)
    expect(groups.map(g => [g.title, g.label, g.general.map(i => i.key), g.shots.map(s => s.id)])).toEqual([
      ['Whole video', undefined, ['r:r2'], []],
      ['beat-01', 'The hall', ['r:r3'], []],
      ['beat-02', 'The door', [], ['beat-02:shot1', 'beat-02:shot2']],
    ])
  })
  test('scopes, shots and changes in words', () => {
    expect(sameScope({kind: 'shot', id: 'a'}, {kind: 'shot', id: 'a'})).toBe(true)
    expect(sameScope({kind: 'shot', id: 'a'}, {kind: 'beat', id: 'a'})).toBe(false)
    expect(sameScope({kind: 'time', start: 1, end: 2}, {kind: 'time', start: 1, end: 3})).toBe(false)
    expect(sameScope({kind: 'global'}, {kind: 'global'})).toBe(true)
    expect([shotGroup('beat-02:shot12'), shotNumber('beat-02:shot12'), shotGroup('beat-02')]).toEqual(['beat-02', 12, 'beat-02'])
    expect(describeShot({framing: 'close', characters: ['kael'], people: {vey: {facing: 'left'}}}, name)).toBe(
      'Framing: close\nIn the picture: Kael\nVey\n  Facing: left',
    )
  })
  test("a shot's change for the shot dialog: only what changed, the shot's fields, then each person's, with names", () => {
    expect(
      shotDiff(
        {framing: 'wide', action: '{Kael} waits', people: {kael: {facing: 'left'}}},
        {framing: 'close', action: '{Kael} waits', people: {kael: {facing: 'right'}, vey: {state: 'sits'}}},
        name,
      ),
    ).toEqual([
      {label: 'Framing', before: 'wide', after: 'close'},
      {label: 'Kael · Facing', before: 'left', after: 'right'},
      {label: 'Vey · Start pose', before: '—', after: 'sits'},
    ])
  })
})
