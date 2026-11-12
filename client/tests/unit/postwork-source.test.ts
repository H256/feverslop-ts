import {describe, expect, test} from 'bun:test'
import {chainSources, defaultSource} from '../../src/features/postwork/forms'

// #832: where the post-work steps start. A project that was made over has no <id>.mp4: the steps started from the first video
// of the list, whose steps had never run - so all of them looked undone although their videos were right there.
const id = 'demo'
const finals = (...names: string[]) => names.map(name => ({file: `${id}${name}`, label: name, preview: false}))
const short = (file: string | undefined) => file?.slice(id.length)

describe('the video the post-work steps start from', () => {
  test('the finished final video, else the final one - as the commands take it', () => {
    expect(short(defaultSource(id, finals('.mp4', '-finished.mp4', '--original.mp4')))).toBe('-finished.mp4')
    expect(short(defaultSource(id, finals('.mp4', '--original.mp4')))).toBe('.mp4')
  })
  test('only made-over videos: the one the steps were run on', () => {
    const all = finals(
      '--original.mp4',
      '--original-48fps.mp4',
      '--original-48fps-finished.mp4',
      '--original-48fps-finished-labeled.mp4',
      '--original-48fps-finished-labeled-credits.mp4',
      '--original-48fps-finished-labeled-credits-intro.mp4',
      '--original-intro.mp4',
    )
    expect(short(defaultSource(id, all))).toBe('--original-48fps-finished.mp4')
    const chain = chainSources(id, all)
    expect(short(chain.label)).toBe('--original-48fps-finished.mp4')
    expect(short(chain.credits)).toBe('--original-48fps-finished-labeled.mp4')
    expect(short(chain.intro)).toBe('--original-48fps-finished-labeled-credits.mp4')
    expect(short(chain.description)).toBe('--original-48fps-finished-labeled-credits-intro.mp4')
  })
  test('"…-48fps-finished" is another video, not a step of "…"', () => {
    // nothing was run on either: the last of the list, the most made-over one
    expect(short(defaultSource(id, finals('--original.mp4', '--original-48fps-finished.mp4')))).toBe('--original-48fps-finished.mp4')
  })
  test('no video: nothing to start from', () => {
    expect(defaultSource(id, [])).toBeUndefined()
  })
})

// #832: a step is made when any video of the project went through it - the newest such video is named
test('what a post-work step has made, from whichever video it started', async () => {
  const {madeByAny} = await import('../../src/features/postwork/forms')
  const final = (file: string, v: number, more = {}) => ({file, v, label: file, state: 'current' as const, preview: false, ...more})
  const finals = [
    final('demo--original-48fps-finished.mp4', 1),
    final('demo--original-48fps-finished-labeled.mp4', 2, {postwork: true}),
    final('demo--original-48fps-finished-labeled-credits.mp4', 3, {postwork: true}),
    final('demo-finished-labeled.mp4', 4, {postwork: true}),
    final('demo-preview-labeled.mp4', 9, {preview: true}),
  ]
  expect(madeByAny('label', finals)?.file).toBe('demo-finished-labeled.mp4')
  expect(madeByAny('credits', finals)?.file).toBe('demo--original-48fps-finished-labeled-credits.mp4')
  expect(madeByAny('intro', finals)).toBeUndefined()
  expect(madeByAny('description', [...finals, final('demo-x-intro.mp4', 5, {youtube: 'text'})])?.file).toBe('demo-x-intro.mp4')
})
