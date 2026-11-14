import {describe, expect, test} from 'bun:test'
import {reviewNext, reviewStep} from '../../src/features/timeline/clips'

// a review plays its clips through, one after the other: a list of some of the clips skips the others
const list = [
  {id: 'c1', start: 0, end: 4},
  {id: 'c3', start: 8, end: 12},
  {id: 'c4', start: 12, end: 16},
]

describe('a review plays on', () => {
  test('leaving a clip, the next one of the list - the clips between are skipped', () => {
    expect(reviewNext(list, list[0]!)?.id).toBe('c3')
  })
  test('leaving a clip right into the next of the list, that one', () => {
    expect(reviewNext(list, list[1]!)?.id).toBe('c4')
  })
  test('leaving the last one, nowhere: the review is through', () => {
    expect(reviewNext(list, list[2]!)).toBeUndefined()
  })
})

describe('← → in a review', () => {
  test('→ the next clip of the list after the playhead', () => {
    expect(reviewStep(list, 1, 1)?.id).toBe('c3')
    expect(reviewStep(list, 9, 1)?.id).toBe('c4')
  })
  test('→ from the last one: nowhere', () => {
    expect(reviewStep(list, 13, 1)).toBeUndefined()
  })
  test('← well into a clip: its start', () => {
    expect(reviewStep(list, 10, -1)?.id).toBe('c3')
  })
  test('← at the start of a clip: the one before in the list', () => {
    expect(reviewStep(list, 8.2, -1)?.id).toBe('c1')
  })
  test('← at the start of the first: the first again', () => {
    expect(reviewStep(list, 0, -1)?.id).toBe('c1')
  })
  test('→ from a clip not in the list: the next one that is', () => {
    expect(reviewStep(list, 5, 1)?.id).toBe('c3')
  })
})
