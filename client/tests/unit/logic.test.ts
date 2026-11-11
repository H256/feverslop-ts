import {describe, expect, test} from 'bun:test'
import type {EditorClip, EditorProject, ProjectListing, SingingLine, SingingView, TimingLine, TimingView} from '../../../shared/workspace'
import {bestSource, chain, fileOf, reviewList, sourceOptions, stateOf} from '../../src/features/timeline/clips'
import {filterOf, groupProjects, matchesState, queryOf} from '../../src/features/projects/listing'
import {changeOf, changesOf, kept, partsOfView, sectionsOf, spanOf, splitAt, type Part} from '../../src/features/singers/parts'
import {crossingOf, fixWords, movedWord, timingChanges} from '../../src/features/timing/words'
import {stagesBetween} from '../../src/features/plan/stages'
import {clock} from '../../src/lib/format'

const words = [
  {text: 'a', start: 1, end: 2},
  {text: 'b', start: 2, end: 3},
  {text: 'c', start: 3, end: 4},
]

describe('the overview', () => {
  const listing = (id: string, group: string, more: Partial<ProjectListing> = {}): ProjectListing => ({
    id,
    kind: 'music',
    title: id,
    group,
    clips: 2,
    rendered: 2,
    pictures: 0,
    changed: 0,
    final: 'current',
    ...more,
  })
  test('takes fold into the newest of their group, unless expanded or searched', () => {
    const projects = [listing('a-2', 'a'), listing('a-1', 'a'), listing('b', 'b')]
    expect(groupProjects(projects, new Set(), false).map(e => [e.project.id, e.others.map(o => o.id)])).toEqual([
      ['a-2', ['a-1']],
      ['b', []],
    ])
    expect(groupProjects(projects, new Set(['a']), false)).toHaveLength(3)
    expect(groupProjects(projects, new Set(), true)).toHaveLength(3)
  })
  test('a state is read from the listing alone', () => {
    expect(matchesState(listing('x', 'x', {rendered: 1}), 'unfinished')).toBe(true)
    expect(matchesState(listing('x', 'x'), 'done')).toBe(true)
    expect(matchesState(listing('x', 'x', {lastRun: {state: 'stopped', command: '', startedAt: '', failures: [], explained: []}}), 'failed')).toBe(true)
  })
  test('the address keeps only what differs from the default, and unknown values fall back', () => {
    expect(queryOf({text: 'x', kind: 'all', state: 'done', page: 1})).toEqual({q: 'x', state: 'done'})
    expect(filterOf({kind: 'tv', state: 'done', page: '-3'})).toEqual({text: '', kind: 'all', state: 'done', page: 1})
  })
})

describe('who sings', () => {
  const line: SingingLine = {
    line: 0,
    text: 'a b c',
    section: 'Verse',
    start: 1,
    end: 4,
    singers: ['ann'],
    words,
    estimated: false,
    beats: ['b1'],
    clips: ['c1'],
  }
  const view: SingingView = {
    singers: ['ann'],
    lines: [line],
    beats: [{id: 'b1', characterIds: ['ann'], planned: true, clips: ['c1']}],
    unplanned: [],
    characters: [
      {id: 'ann', name: 'Ann', beats: ['b1'], clips: ['c1']},
      {id: 'ben', name: 'Ben', beats: [], clips: ['c9']},
    ],
  }
  test('neighbours with the same singers are one part, the first from word 0', () => {
    const parts: Part[] = [
      {from: 0, singers: new Set(['ann'])},
      {from: 1, singers: new Set(['ann'])},
      {from: 2, singers: new Set(['ben', 'ann'])},
    ]
    expect(kept(parts)).toEqual([
      {from: 0, singers: ['ann']},
      {from: 2, singers: ['ann', 'ben']},
    ])
  })
  test('a click between two words splits there, a second click takes it back', () => {
    const parts = partsOfView(line)
    expect(splitAt(parts, 2)).toBe(1)
    expect(parts.map(p => p.from)).toEqual([0, 2])
    expect(spanOf(line, parts, 1)).toEqual({start: 3, end: 4})
    expect(splitAt(parts, 2)).toBe(0)
    expect(parts.map(p => p.from)).toEqual([0])
  })
  test('a new singer: the beat is planned again and every clip of theirs goes stale; the request has parts only where they change', () => {
    const assigned = new Map([
      [
        0,
        [
          {from: 0, singers: new Set(['ann'])},
          {from: 1, singers: new Set(['ben'])},
        ],
      ],
    ])
    const changes = changesOf(view, l => assigned.get(l.line)!)
    expect(changes.replanned).toEqual(['b1'])
    expect(changes.newSingers).toEqual(['ben'])
    expect(changes.added).toEqual([{beat: 'b1', id: 'ben'}])
    expect(changes.clips).toEqual(['c1', 'c9'])
    expect(changeOf(changes.lines, l => assigned.get(l.line)!)).toEqual({
      lines: [
        {
          line: 0,
          singers: ['ann', 'ben'],
          parts: [
            {from: 0, singers: ['ann']},
            {from: 1, singers: ['ben']},
          ],
        },
      ],
    })
  })
  test('lines in their sections, in the order of the song', () => {
    expect(sectionsOf([line, {...line, line: 1}, {...line, line: 2, section: 'Chorus'}]).map(s => [s.name, s.lines.length])).toEqual([
      ['Verse', 2],
      ['Chorus', 1],
    ])
  })
})

describe('the timing of the words', () => {
  const line: TimingLine = {line: 0, section: 'Verse', text: 'a b c', words, estimated: true, byHand: false, beats: ['b1']}
  const view: TimingView = {
    duration: 10,
    lines: [line],
    cuts: [
      {id: 'c1', start: 0, end: 2.5, beat: 'b1'},
      {id: 'c2', start: 2.5, end: 10},
    ],
    beats: [{id: 'b1', planned: true, clips: ['c1']}],
    unplanned: [],
    outdated: [],
  }
  test('moving a word stops at its neighbors without shortening them', () => {
    expect(movedWord(words, 1, 0.8, undefined, 10)).toEqual(words)
    expect(movedWord(words, 1, 5, undefined, 10)).toEqual(words)
  })
  test('words back where they were are no change; words stay inside the song', () => {
    expect(fixWords(line, words, 10)).toBeUndefined()
    expect(
      fixWords(
        line,
        words.map(w => ({start: w.start + 20, end: w.end + 20})),
        10,
      )!.every(w => w.end <= 10),
    ).toBe(true)
  })
  test('a cut inside a word is found, and the beats of the cuts a moved line touches are planned again', () => {
    expect(crossingOf(view, words).map(c => c.word.text)).toEqual(['b'])
    const changes = timingChanges(view, [line], () => words.map(w => ({...w, start: w.start + 0.1, end: w.end + 0.1})))
    expect(changes.replanned).toEqual(['b1'])
    expect(changes.clips).toEqual(['c1'])
  })
})

describe('the timeline', () => {
  const clip = (id: string, more: Partial<EditorClip> = {}): EditorClip => ({
    id,
    frameStart: 0,
    frames: 1,
    start: 0,
    end: 1,
    group: 'g',
    context: {label: ''},
    prompt: '',
    shots: [],
    lines: [],
    pictures: [],
    audio: [],
    dropped: [],
    marks: [],
    refined: [],
    ...more,
  })
  const project = {
    clips: [clip('c1', {video: {file: 'v1', v: 1}, next: 'c2'}), clip('c2', {next: 'c3', preview: {file: 'p2', v: 1}}), clip('c3')],
    finals: [],
    refinedVariants: [],
    song: undefined,
  } as unknown as EditorProject
  test('what goes on from a clip, one after the other', () => {
    expect(chain(project, project.clips[0]!)).toEqual(['c2', 'c3'])
  })
  test('a clip plays its video, else its preview; previews are asked for', () => {
    expect(fileOf(project.clips[1]!, 'clips')?.file).toBe('p2')
    expect(fileOf(project.clips[0]!, 'previews')?.file).toBe('v1')
    expect(sourceOptions(project).map(o => o.value)).toEqual(['clips', 'previews'])
    expect(bestSource(project)).toBe('clips')
  })
  test('what a clip is, and what a review goes through', () => {
    expect(stateOf(project.clips[2]!, {clips: {}, pictures: {}})).toBe('missing')
    expect(stateOf(project.clips[0]!, {clips: {}, pictures: {}})).toBe('unknown')
    expect(reviewList(project, new Set(), {clips: {c1: 'current'}, pictures: {}}).map(c => c.id)).toEqual(['c1'])
  })
})

test('the stages a plan run makes, and a clock', () => {
  expect(stagesBetween('cast', 'look')).toEqual(['cast', 'look'])
  expect(stagesBetween(undefined)).toEqual(['plan'])
  expect(clock(75.25)).toBe('1:15.3')
  expect(clock(75.25, false)).toBe('1:15')
})

// #829: the run dock reads the events of a run, never its log
test('what the events of a run say: its step, warnings, failure - only of the run followed', async () => {
  const {runSaid} = await import('../../src/services/run')
  const said = runSaid(
    [
      {at: 1, type: 'failed', message: 'an older run'},
      {at: 10, type: 'step', state: 'cached', name: 'story', title: '2 · Story'},
      {at: 11, type: 'step', state: 'started', name: 'beats', title: '3 · Beats'},
      {at: 12, type: 'warning', message: 'a beat without a place'},
      {at: 13, type: 'step', state: 'done', name: 'beats', title: '3 · Beats'},
      {at: 14, type: 'failed', message: 'EPERM', advice: 'Close the program that holds it.'},
    ],
    5,
  )
  expect(said).toEqual({step: '3 · Beats', warnings: ['a beat without a place'], failure: {message: 'EPERM', advice: 'Close the program that holds it.'}})
})
