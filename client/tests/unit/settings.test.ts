import {describe, expect, test} from 'bun:test'
import type {ConfigImpact, SettingView} from '../../../shared/workspace'
import {changesOf, costOf, fieldTextOf, groupsOf, labelOf, textOfValue, valueOfField, valueOfText} from '../../src/features/settings/settings'

const setting = (key: string, value: unknown, more: Partial<SettingView> = {}): SettingView => ({
  key,
  label: key,
  group: 'Workflows',
  control: 'text',
  note: '',
  value,
  default: value,
  own: false,
  ...more,
})

describe('the settings of a project', () => {
  test('only what differs from what the project has is sent', () => {
    const settings = [setting('videoWorkflow', 'h3-ref2video'), setting('qaRetries', 0, {group: 'Seed and retries'})]
    expect(changesOf(settings, {videoWorkflow: 'h3-ref2video', qaRetries: 0})).toEqual({})
    expect(changesOf(settings, {videoWorkflow: 'h3-ref2video-prism-2pass', qaRetries: 0})).toEqual({videoWorkflow: 'h3-ref2video-prism-2pass'})
  })
  test('the default, where config.json has another value, takes the key out of the file', () => {
    const settings = [setting('seed', 7, {default: -1, own: true}), setting('finalFps', 24, {default: 24})]
    expect(changesOf(settings, {seed: -1, finalFps: 24})).toEqual({seed: null})
    expect(changesOf(settings, {seed: 8, finalFps: 48})).toEqual({seed: 8, finalFps: 48})
  })
  test('a custom finish - an object - is the same as itself, and a choice of it changes nothing', () => {
    const finish = {colorMatch: 0.5}
    expect(changesOf([setting('finish', finish, {default: false, own: true})], {finish: {colorMatch: 0.5}})).toEqual({})
    expect(changesOf([setting('finish', finish, {default: false, own: true})], {finish: true})).toEqual({finish: true})
  })
  test('a size typed as text is a number where it looks like one, else the text', () => {
    expect(valueOfText('1.2')).toBe(1.2)
    expect(valueOfText('-1')).toBe(-1)
    expect(valueOfText('1280x720')).toBe('1280x720')
    expect(valueOfText('16:9')).toBe('16:9')
    expect(textOfValue(-1)).toBe('-1')
    expect(textOfValue('16:9')).toBe('16:9')
    expect(textOfValue(false)).toBe('false')
  })
  test('a value is read by the label of its choice - on, not true - else as it is', () => {
    const pin = setting('pinStartFrame', true, {
      control: 'select',
      choices: [
        {value: true, label: 'on'},
        {value: false, label: 'off'},
      ],
    })
    expect(labelOf(pin, true)).toBe('on')
    expect(labelOf(pin, false)).toBe('off')
    expect(labelOf(setting('videoAspect', '16:9'), '16:9')).toBe('16:9')
    expect(labelOf(setting('seed', -1), -1)).toBe('-1')
  })
  test('the groups come in the order of the settings', () => {
    const settings = [setting('videoWorkflow', 'a'), setting('videoResolution', 2, {group: 'Size'}), setting('imageWorkflow', 'b')]
    expect(groupsOf(settings).map(g => [g.name, g.settings.map(s => s.key)])).toEqual([
      ['Workflows', ['videoWorkflow', 'imageWorkflow']],
      ['Size', ['videoResolution']],
    ])
  })
  test('what a change costs is said in the numbers of the project, or not at all', () => {
    const impact = (clips: string[], pictures: string[]): ConfigImpact => ({
      problems: [],
      changed: ['videoWorkflow'],
      stale: {clips, pictures},
      rendered: {clips: 9, pictures: 4},
      notes: [],
    })
    expect(costOf(impact([], []))).toEqual([])
    expect(costOf(impact(['slot-001', 'slot-002'], []))).toEqual([
      '2 of 9 rendered clips would be made from something else then: they are stale, and nothing is rendered on its own.',
    ])
    expect(costOf(impact(['slot-001'], ['ann']))[0]).toBe(
      '1 of 9 rendered clips and 1 of 4 rendered pictures would be made from something else then: they are stale, and nothing is rendered on its own.',
    )
  })
  // #834: -1 is what the file keeps; the page says what it means
  test('a value that means "not set by you" is an empty field with its meaning as the placeholder, and back', () => {
    const steps = setting('videoSteps', -1, {control: 'number', auto: {value: -1, label: 'Workflow default'}})
    expect(fieldTextOf(steps, -1)).toBe('')
    expect(labelOf(steps, -1)).toBe('Workflow default')
    expect(valueOfField(steps, '')).toBe(-1)
    expect(valueOfField(steps, ' ')).toBe(-1)
    expect(valueOfField(steps, '8')).toBe(8)
    expect(fieldTextOf(steps, 8)).toBe('8')
    // a setting without such a value keeps -1 as a number
    expect(valueOfField(setting('contextFrames', 0), '-1')).toBe(-1)
  })
})
