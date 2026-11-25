import {describe, expect, test} from 'bun:test'
import type {EditorClip, EditorProject} from '../../../shared/workspace'
import {boardRows, castOf, intentOf} from '../../src/features/timeline/storyboard'

const clip = (id: string, start: number, end: number, more: Partial<EditorClip> = {}): EditorClip =>
  ({
    id,
    start,
    end,
    frameStart: 0,
    frames: 0,
    group: '',
    context: {label: `beat of ${id}`, text: `what happens in ${id}`},
    prompt: '',
    shots: [],
    lines: [],
    pictures: [],
    audio: [],
    dropped: [],
    marks: [],
    refined: [],
    ...more,
  }) as EditorClip
const picture = (name: string, kind: string, exists = true) => ({id: name, label: '', file: `${name}.png`, kind, name, subject: '', description: '', exists})

describe('the storyboard', () => {
  test('rows follow the beats, a clip no beat holds gets a row of its own, and a row counts its current clips', () => {
    const project = {
      clips: [clip('c1', 0, 4, {video: {file: 'c1.mp4', v: 1}}), clip('c2', 4, 9), clip('c3', 9, 12)],
      beats: [{id: 'beat-07', label: 'Lyra screams the final chorus', start: 0, end: 9, planned: true, clips: ['c1', 'c2'], characters: []}],
      groups: [],
    } as unknown as EditorProject
    const rows = boardRows(project, {clips: {c1: 'current'}, pictures: {}})
    expect(rows[0]!.title).toBe('Lyra screams the final chorus') // the head says it in one line, as the Beats lane does
    expect(rows.map(r => [r.label, r.clips.map(c => c.id), r.seconds, r.done])).toEqual([
      ['Beat 7', ['c1', 'c2'], 9, 1],
      ['Other clips', ['c3'], 3, 0],
    ])
  })
  test('without beats the rows are the sections, by the middle of each clip', () => {
    const project = {
      clips: [clip('c1', 0, 4), clip('c2', 4, 9)],
      groups: [
        {id: 'g1', label: 'Verse', start: 0, end: 5},
        {id: 'g2', label: 'Chorus', start: 5, end: 10},
      ],
    } as unknown as EditorProject
    expect(boardRows(project, {clips: {}, pictures: {}}).map(r => [r.label, r.clips.map(c => c.id)])).toEqual([
      ['Verse', ['c1']],
      ['Chorus', ['c2']],
    ])
  })
  test('the cast chips are the people of a clip once each, not its place, props, frame or missing pictures', () => {
    const one = clip('c1', 0, 4, {
      pictures: [
        picture('Mia', 'character'),
        picture('Mia', 'character'),
        picture('Hall', 'location'),
        picture('Lute', 'prop'),
        picture('Ben', 'character', false),
      ],
    })
    expect(castOf(one).map(p => p.name)).toEqual(['Mia'])
  })
  test('a card says the first shot action, else what the beat is about', () => {
    expect(intentOf(clip('c1', 0, 4))).toBe('what happens in c1')
    expect(intentOf(clip('c1', 0, 4, {shots: [{label: '', at: 0, framing: '', camera: '', subjects: [], people: [], action: 'she turns'}]}))).toBe('she turns')
  })
})
