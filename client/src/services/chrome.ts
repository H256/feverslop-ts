import {ref, toValue, watchEffect, onScopeDispose, type MaybeRefOrGetter} from 'vue'
import {defineService} from './service'

/** What the top bar says: the page's title. Its navigation and chips are teleported in by the page itself. */
export function createChrome() {
  // counts the changes of the theme: what draws on a canvas draws again in the other colours
  const theme = ref(0)
  const themeChanged = () => {
    theme.value++
  }
  const system = matchMedia('(prefers-color-scheme: dark)')
  system.addEventListener('change', themeChanged)
  return {title: ref('Workspace'), theme, themeChanged, dispose: () => system.removeEventListener('change', themeChanged)}
}
export type Chrome = ReturnType<typeof createChrome>
export const ChromeService = defineService<Chrome>('chrome')

/** The title of the page, in the top bar and the browser tab - put back when the page goes. */
export function usePageTitle(heading: MaybeRefOrGetter<string>, tab: MaybeRefOrGetter<string | undefined> = () => `${toValue(heading)} · Workspace`) {
  const chrome = ChromeService.use()
  watchEffect(() => {
    chrome.title.value = toValue(heading)
    document.title = toValue(tab) ?? 'Workspace'
  })
  onScopeDispose(() => {
    chrome.title.value = 'Workspace'
    document.title = 'Workspace'
  })
}
/** Where pages put their own parts of the top bar. */
export const TOP_NAV = '#top-nav'
export const TOP_CHIPS = '#top-chips'
