import {watch} from 'vue'
import {usePolling} from '../../composables/usePolling'
import {useResource} from '../../composables/useResource'
import {errorText} from '../../lib/format'
import {useRunDock} from '../../services/run'
import {useToasts} from '../../services/toasts'
import {useProject} from './session'

/**
 * The data of one page of a project, read when the page opens and again when a run ends - and after a change made on the page: then
 * the project's snapshot is read again too, since what the page changed shows elsewhere. A page that has its data shows it on; a later
 * reading that fails is said, not hidden behind it.
 *
 * `live`: read again every few seconds while a run goes on - a page of pictures shows each one as soon as it is rendered, not when the
 * whole run is done. What is typed on the page stays: a draft follows the data only while it is unchanged.
 */
const LIVE_MS = 5000

export function usePageData<T>(load: (signal: AbortSignal) => Promise<T>, {live = false} = {}) {
  const session = useProject()
  const toasts = useToasts()
  const resource = useResource(load)
  const dock = useRunDock()
  if (live) usePolling(async () => (dock.running() ? resource.reload() : undefined), LIVE_MS, {onFocus: false})
  dock.onEnd(() => {
    void resource.reload()
  })
  watch(resource.error, error => {
    if (error && resource.data.value !== undefined) toasts.show(`Could not read this page again: ${error}`, true)
  })
  /** True when the page and the project show what is in the folder now. */
  const refresh = async () => {
    const [page, project] = await Promise.all([
      resource.reload(),
      session.reload().then(
        () => true,
        cause => {
          toasts.show(`Could not read the project again: ${errorText(cause)}`, true)
          return false
        },
      ),
    ])
    return page && project
  }
  return {...resource, refresh}
}
