import type {ConfigChange, ConfigImpact, SettingView} from '../../../../shared/workspace'
import {plural} from '../../lib/format'

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What a text field holds as the setting: 1.2 and -1 are numbers (a size), 16:9 and 1280x720 stay text. */
export const valueOfText = (text: string): unknown => text.trim() !== '' && /^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : text
export const textOfValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value) ?? ''
/** A value as the person reads it: by the label of the choice it is (on, off, mild), else as it is. */
export const labelOf = (setting: SettingView, value: unknown) => setting.choices?.find(c => same(c.value, value))?.label ?? textOfValue(value)

/**
 * What to send for the settings as they are in the form: only what differs from what the project has. A value that is the default
 * takes the key out of config.json (`null`) - it was written there, or it would not differ.
 */
export function changesOf(settings: SettingView[], draft: Record<string, unknown>): ConfigChange {
    const change: ConfigChange = {}
    for (const setting of settings) {
        const value = draft[setting.key]
        if (same(value, setting.value)) continue
        change[setting.key] = same(value, setting.default) ? null : value
    }
    return change
}

/** The groups in the order the settings come, each with its settings. */
export function groupsOf(settings: SettingView[]) {
    const groups: {name: SettingView['group'], settings: SettingView[]}[] = []
    for (const setting of settings) {
        const group = groups.find(g => g.name === setting.group)
        if (group) group.settings.push(setting)
        else groups.push({name: setting.group, settings: [setting]})
    }
    return groups
}

/** What a change costs, in the words of the question before it is saved. */
export function costOf(impact: ConfigImpact): string[] {
    const {clips, pictures} = impact.stale
    const parts = [
        clips.length > 0 && `${clips.length} of ${plural(impact.rendered.clips, 'rendered clip')}`,
        pictures.length > 0 && `${pictures.length} of ${plural(impact.rendered.pictures, 'rendered picture')}`,
    ].filter(Boolean)
    return parts.length ? [`${parts.join(' and ')} would be made from something else then: they are stale, and nothing is rendered on its own.`] : []
}
