import {describe, expect, test} from 'bun:test'
import {createToasts, MOST_ERRORS} from '../../src/services/toasts'

const texts = (toasts: ReturnType<typeof createToasts>) => toasts.errors.value.map(e => e.text)

describe('the messages at the foot of the page (#940)', () => {
  test('a notice after a failure does not take the failure away; the failure stays until it is closed', async () => {
    const toasts = createToasts()
    toasts.show('Could not save: the disk is full', true)
    toasts.show('Saved')
    expect(texts(toasts)).toEqual(['Could not save: the disk is full'])
    expect(toasts.notice.value?.text).toBe('Saved')
    await new Promise(resolve => setTimeout(resolve, 3100))
    expect(toasts.notice.value).toBeUndefined()
    expect(texts(toasts)).toEqual(['Could not save: the disk is full'])
    toasts.dismiss(toasts.errors.value[0]!.id)
    expect(texts(toasts)).toEqual([])
    toasts.dispose()
  })

  test('several failures are kept, the newest last, never more than a few; the same one again is said once', () => {
    const toasts = createToasts()
    for (let n = 1; n <= MOST_ERRORS + 2; n++) toasts.show(`failure ${n}`, true)
    toasts.show(`failure ${MOST_ERRORS + 1}`, true)
    expect(toasts.errors.value).toHaveLength(MOST_ERRORS)
    expect(texts(toasts).at(-1)).toBe(`failure ${MOST_ERRORS + 1}`)
    expect(new Set(texts(toasts)).size).toBe(MOST_ERRORS)
  })

  test('a guarded action: its failure goes when the same action works the next time - not when another one works', async () => {
    const toasts = createToasts()
    let fails = true
    const save = toasts.guard(() => (fails ? Promise.reject(new Error('the server said no')) : Promise.resolve()))
    const other = toasts.guard(() => Promise.resolve())
    await save()
    expect(texts(toasts)).toEqual(['the server said no'])
    await other()
    expect(texts(toasts)).toEqual(['the server said no'])
    // tried again and failed again: still one
    await save()
    expect(texts(toasts)).toEqual(['the server said no'])
    fails = false
    await save()
    expect(texts(toasts)).toEqual([])
  })

  test('a failure said for a source goes with clear(source); a request not wanted any more is no failure', () => {
    const toasts = createToasts()
    const page = {}
    toasts.show('Could not read this page again: offline', true, page)
    toasts.show('Could not start the run', true)
    toasts.clear(page)
    expect(texts(toasts)).toEqual(['Could not start the run'])
    toasts.fail(new DOMException('gone', 'AbortError'))
    expect(texts(toasts)).toEqual(['Could not start the run'])
  })
})
