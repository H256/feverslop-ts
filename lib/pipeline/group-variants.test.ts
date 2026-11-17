import {expect, test} from 'bun:test'
import {sameStart} from './beats.ts'

// A redo of the beats redoes the looks of a group's members: a member whose look is asked from the same input as before is
// taken as it was, so its picture stays and the clips keep their references (the audience of tides-of-eternal-flame-261115)
test('a member is taken from before the redo only while the looks before it are the same', () => {
    const before = ['group look', 'member 2', 'member 3']
    expect(sameStart(before, ['group look'])).toBe(true)
    expect(sameStart(before, ['group look', 'member 2'])).toBe(true)
    // the group's own look is another one now: every member is asked again
    expect(sameStart(before, ['another look'])).toBe(false)
    // more members than before: the new ones are asked
    expect(sameStart(before, ['group look', 'member 2', 'member 3'])).toBe(false)
    expect(sameStart(undefined, ['group look'])).toBe(false)
})
