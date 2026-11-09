import {computed, reactive, shallowRef, type Ref} from 'vue'
import type {SettingView} from '../../../../shared/workspace'
import {changesOf, same} from './settings'

/**
 * The settings as changed in the form and not saved yet. What is changed is measured against the reading the form started from: a
 * newer reading (a run ended, another tab saved) is taken over only while nothing here is changed - never over what someone typed.
 */
export function useSettingsDraft(settings: Ref<SettingView[]>) {
  const base = shallowRef(settings.value)
  const draft = reactive<Record<string, unknown>>({})
  const reset = () => {
    base.value = settings.value
    for (const key of Object.keys(draft)) delete draft[key]
    for (const setting of base.value) draft[setting.key] = setting.value
  }
  reset()
  const changes = computed(() => changesOf(base.value, draft))
  const dirty = computed(() => Object.keys(changes.value).length > 0)
  const isChanged = (key: string) => key in changes.value
  /** The default, as a change: saved, it takes the key out of config.json. */
  const toDefault = (setting: SettingView) => {
    draft[setting.key] = setting.default
  }
  const undo = (setting: SettingView) => {
    draft[setting.key] = base.value.find(s => s.key === setting.key)!.value
  }
  const isDefault = (setting: SettingView) => same(draft[setting.key], setting.default)
  return {draft, changes, dirty, isChanged, isDefault, toDefault, undo, reset, base}
}
export type SettingsDraft = ReturnType<typeof useSettingsDraft>
