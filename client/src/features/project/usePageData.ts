import {useResource} from '../../composables/useResource'
import {useRunDock} from '../../services/run'
import {useProject} from './session'

/**
 * The data of one page of a project, read when the page opens and again when a run ends - and after a change made on the page: then
 * the project's snapshot is read again too, since what the page changed shows elsewhere.
 */
export function usePageData<T>(load: (signal: AbortSignal) => Promise<T>) {
  const session = useProject()
  const resource = useResource(load)
  useRunDock().onEnd(() => { void resource.reload() })
  const refresh = async () => { await Promise.all([resource.reload(), session.reload().catch(() => false)]) }
  return {...resource, refresh}
}
