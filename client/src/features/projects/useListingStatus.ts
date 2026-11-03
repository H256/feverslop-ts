import {reactive, watch, type Ref} from 'vue'
import type {ListingStatus, ProjectListing} from '../../../../shared/workspace'
import {projectRoot} from '../../api/urls'
import {workspace} from '../../api/workspace'

/**
 * What costs some hashing comes after the page is up: one project at a time, only for the cards shown, stopped when they change.
 * What is known stays known while the page lives.
 */
export function useListingStatus(shown: Ref<ProjectListing[]>) {
  const statuses = reactive(new Map<string, ListingStatus>())
  watch(shown, async (projects, _, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    for (const project of projects) {
      const key = projectRoot(project)
      if (controller.signal.aborted) return
      if (statuses.has(key)) continue
      try {
        statuses.set(key, await workspace.status(project, controller.signal))
      } catch {}
    }
  }, {immediate: true})
  return {statusOf: (project: ProjectListing) => statuses.get(projectRoot(project)), clear: () => statuses.clear()}
}
