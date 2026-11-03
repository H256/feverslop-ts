import {describe, expect, test} from 'bun:test'
import {effectScope, nextTick, ref} from 'vue'
import type {SingingView, TimingLine} from '../../../shared/workspace'
import {getJson} from '../../src/api/http'
import {createProjectSession} from '../../src/features/project/session'
import {usePointerDrag} from '../../src/composables/usePointerDrag'
import {createRunDock} from '../../src/services/run'
import type {Toasts} from '../../src/services/toasts'
import {useSingingDraft} from '../../src/features/singers/useSingingDraft'
import {fixWords, MIN_WORD, shifted} from '../../src/features/timing/words'
import type {RunDock} from '../../src/services/run'
import type {Servers} from '../../src/services/servers'

/** fetch answered by hand: each request waits until the test says what it gets. */
function heldFetch() {
  const waiting: Array<(body: string) => void> = []
  globalThis.fetch = (() => new Promise<Response>(resolve => { waiting.push(body => resolve(new Response(body))) })) as unknown as typeof fetch
  return waiting
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('the project of a page', () => {
  test('an older reading that comes last does not put back what is no longer so', async () => {
    const answers = heldFetch()
    const session = createProjectSession('music', 'demo', {run: {} as RunDock, servers: {} as Servers})
    const older = session.reload(), newer = session.reload()
    answers[1]!(JSON.stringify({id: 'demo', title: 'new'}))
    await settle()
    answers[0]!(JSON.stringify({id: 'demo', title: 'old'}))
    expect(await older).toBe(true)
    expect(await newer).toBe(true)
    expect(session.project.value?.title).toBe('new')
  })
})

test('an answer that is not JSON is a failure, not data that is undefined', async () => {
  globalThis.fetch = (async () => new Response('<html>proxy error</html>', {status: 200})) as unknown as typeof fetch
  let said = ''
  await getJson('/p/music/demo/api/look?x=1').catch((cause: Error) => { said = cause.message })
  expect(said).toBe('The answer of /p/music/demo/api/look is not JSON')
})

test('who sings: a line changed by another hand is not a change made here', async () => {
  const line = (singers: string[]) => ({line: 0, text: 'a b', section: 'Verse', start: 1, end: 2, singers, words: [], estimated: false, beats: [], clips: []})
  const view = (singers: string[]): SingingView => ({singers: ['ann', 'ben'], lines: [line(singers)], beats: [], unplanned: [], characters: []})
  const shown = ref(view(['ann']))
  const draft = useSingingDraft(shown)
  shown.value = view(['ben'])
  await nextTick()
  expect(draft.changes.value.lines).toHaveLength(0)
  draft.reset()
  draft.toggle(shown.value.lines[0]!, 'ann')
  expect(draft.changes.value.lines).toHaveLength(1)
})

describe('the timing of the words', () => {
  const line: TimingLine = {line: 0, section: 'Verse', text: 'a', words: [{text: 'a', start: 1, end: 2}], estimated: false, byHand: false, beats: []}
  test('a word moved before the song starts stays a word: 0 ≤ start, start + MIN_WORD ≤ end ≤ duration', () => {
    for (const span of [{start: -2, end: -1}, {start: 9.99, end: 12}, {start: 3, end: 2}]) {
      const [w] = fixWords(line, [span], 10)!
      expect(w!.start >= 0 && w!.end <= 10 && w!.end - w!.start >= MIN_WORD - 1e-9).toBe(true)
    }
  })
  test('a whole line moved as far as the song goes keeps its length', () => {
    expect(shifted([{start: 1, end: 2}, {start: 2, end: 3}], -3, 10)).toEqual([{start: 0, end: 1}, {start: 1, end: 2}])
    expect(shifted([{start: 7, end: 9}], 5, 10)).toEqual([{start: 8, end: 10}])
  })
})

test('a refinish: a preset as it is, or every step said; only the clips given', async () => {
  const {newRefinish, refinishRequest} = await import('../../src/features/timeline/forms')
  expect(refinishRequest(newRefinish(), [])).toEqual({type: 'refinish', preset: 'grade'})
  expect(refinishRequest({...newRefinish(), preset: 'custom', fps: '48'}, ['clip-1'])).toEqual({type: 'refinish', upscale: 'none', size: 'fullhd', denoise: 0.2, fps: 48, finish: true, only: ['clip-1']})
})

describe('runs and the scope they were asked in', () => {
  test('a run asked for in one scope is not followed when the answer comes after another scope is followed', () => {
    const opened: string[] = []
    globalThis.EventSource = class { constructor(url: string) { opened.push(url) } addEventListener() {} close() {} } as unknown as typeof EventSource
    const dock = createRunDock({show: () => {}} as unknown as Toasts)
    const library = effectScope()
    library.run(() => dock.follow({events: '/api/library/run-events'}))
    const started = dock.starter()
    // back to a project before the server answered
    library.stop()
    effectScope().run(() => dock.follow({events: '/p/music/demo/api/run-events'}))
    opened.length = 0
    started({source: 'here', command: 'bun tools/create-asset.ts', pid: 1, startedAt: '', running: true})
    expect(dock.current.value).toBe(null)
    expect(opened).toEqual([])
    // asked and answered in the same scope: followed from the start
    dock.starter()({source: 'here', command: 'bun index.ts demo', pid: 2, startedAt: '', running: true})
    expect(opened).toEqual(['/p/music/demo/api/run-events?after=0'])
  })
})

describe('a drag', () => {
  test('let go: it ends as released; the page gone mid-drag: it ends as not released, and nothing listens any more', () => {
    const ends: boolean[] = []
    let moves = 0
    const page = effectScope()
    const drag = page.run(() => usePointerDrag())!
    drag(() => { moves++ }, released => ends.push(released))
    dispatchEvent(new Event('pointermove'))
    dispatchEvent(new Event('pointerup'))
    drag(() => { moves++ }, released => ends.push(released))
    page.stop()
    dispatchEvent(new Event('pointermove'))
    dispatchEvent(new Event('pointerup'))
    expect(ends).toEqual([true, false])
    expect(moves).toBe(1)
  })
})
