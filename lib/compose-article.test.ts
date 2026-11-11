import {expect, test} from 'bun:test'
import {the} from './compose.ts'

// #821: a place the cast step named with its article ("the empty rooms") made every clip prompt say "the the empty rooms".
test('a name gets its article once', () => {
    expect(the('Blackwood Forest')).toBe('the Blackwood Forest')
    expect(the('old mill')).toBe('the old mill')
    expect(the('the old mill')).toBe('the old mill')
    expect(the('The Empty Rooms')).toBe('The Empty Rooms')
    expect(the('THE CORRIDOR')).toBe('THE CORRIDOR')
    expect(the('a circus ring built within a graveyard')).toBe('a circus ring built within a graveyard')
    expect(the('an attic')).toBe('an attic')
    // a name that only begins with the letters of one
    expect(the('theatre')).toBe('the theatre')
    expect(the('Anna')).toBe('the Anna')
})
