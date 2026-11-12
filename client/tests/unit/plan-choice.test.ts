import {expect, test} from 'bun:test'
import {planAsked} from '../../src/features/plan/planChoice'

// #836: the dry run and the run itself are asked for the same choice; scenes go only with a film's shot plan
test('the plan run of the question before it', () => {
  expect(planAsked({redo: '', scenes: []})).toEqual({})
  expect(planAsked({redo: 'beats', scenes: []}, 'look')).toEqual({redo: ['beats'], until: 'look'})
  expect(planAsked({redo: 'coverage', scenes: ['s6', 's7']})).toEqual({redo: ['coverage'], scenes: ['s6', 's7']})
  // picked, then another step chosen: the scenes are not asked for
  expect(planAsked({redo: 'screenplay', scenes: ['s6']})).toEqual({redo: ['screenplay']})
})
