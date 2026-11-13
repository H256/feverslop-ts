import {expect, test} from 'bun:test'
import {messageOf, shownOf, textOf} from './text.ts'

test('an LLM answer or a form field is text, or nothing - never "[object Object]" (#891)', () => {
    expect(textOf('a room')).toBe('a room')
    expect(textOf({layout: 'x'})).toBe('')
    expect(textOf(undefined)).toBe('')
    expect(textOf(7)).toBe('')
})

test('a value shown: numbers and booleans as written, nothing as nothing, the rest as JSON', () => {
    expect([shownOf('wide'), shownOf(22), shownOf(false), shownOf(null), shownOf(undefined)]).toEqual(['wide', '22', 'false', '', ''])
    expect(shownOf({size: 'close'})).toBe('{"size":"close"}')
})

test('what went wrong: the message of an error, else the value shown', () => {
    expect(messageOf(new Error('cut off'))).toBe('cut off')
    expect(messageOf('timeout')).toBe('timeout')
    expect(messageOf({code: 5})).toBe('{"code":5}')
})
