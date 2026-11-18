import {expect, test} from 'bun:test'
import {castingNotices} from '../../src/features/casting/notices'

test('castingNotices: the unlisted roles are one sentence, other warnings stay', () => {
  const {unlisted, rest} = castingNotices([
    'characters without an entry in casting.json run as "project:": tamsin-vey, soren-hale',
    'locations without an entry in casting.json run as "project:": platform',
    'something else',
  ])
  expect(unlisted).toEqual({text: 'Not in casting.json yet: 2 characters, 1 place. This project makes them itself.', names: 'tamsin-vey, soren-hale, platform'})
  expect(rest).toEqual(['something else'])
})

test('castingNotices: nothing unlisted, no sentence', () => {
  expect(castingNotices([]).unlisted).toBeUndefined()
})
