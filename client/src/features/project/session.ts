import {computed, ref, shallowRef} from 'vue'
import type {EditorProject, ProjectKind, RunRequest} from '../../../../shared/workspace'
import {projectApi} from '../../api/project'
import {projectRoot, rootsOf} from '../../api/urls'
import type {RunDock} from '../../services/run'
import {defineService} from '../../services/service'
import type {Servers} from '../../services/servers'

/**
 * One project while its pages are open: its endpoints, its media roots, the snapshot of /api/project and its runs. Made by
 * ProjectLayout for one (kind, id); another project is another session.
 */
export function createProjectSession(kind: ProjectKind, id: string, deps: {run: RunDock; servers: Servers}) {
  const root = projectRoot({kind, id})
  const api = projectApi(root)
  const project = shallowRef<EditorProject>()
  const error = ref('')
  let text = ''

  /**
   * The folder is the model: read again, and taken over only when it changed. True when it did. Polling, the end of a run and a change
   * made on a page read it at the same time: only the newest reading is taken over - an older answer that comes last would put back
   * what is no longer so - and whoever asked before waits for that one.
   */
  let generation = 0
  let newest: Promise<boolean> = Promise.resolve(false)
  const reload = (signal?: AbortSignal): Promise<boolean> => {
    const mine = ++generation
    const reading = (async () => {
      const next = await api.projectText(signal)
      if (mine !== generation) return newest
      if (next === text) return false
      text = next
      project.value = JSON.parse(next) as EditorProject
      return true
    })()
    newest = reading
    return reading
  }
  /**
   * Starts a run for what was asked - after the question, with the servers chosen in it. Followed only while this project's runs are:
   * an answer that comes after its pages went starts nothing in what is open by then (the run dock checks that).
   */
  const start = async (action: RunRequest) => {
    if (deps.run.running()) throw new Error('a run is going on - wait for it, or stop it')
    const started = deps.run.starter()
    const {run} = await api.run(action, deps.servers.take())
    started(run, action)
  }
  const busy = computed(() => !!deps.run.current.value?.running)
  return {kind, id, root, api, roots: rootsOf(root), project, error, reload, start, starter: deps.run.starter, busy, takeServers: deps.servers.take}
}
export type ProjectSession = ReturnType<typeof createProjectSession>
export const ProjectService = defineService<ProjectSession>('project')
export const useProjectSession = ProjectService.use

/** A page of a project: its session, with the snapshot that ProjectLayout has loaded before any page is shown. */
export function useProject() {
  const session = ProjectService.use()
  const project = computed(() => {
    if (!session.project.value) throw new Error('the project is not loaded yet')
    return session.project.value
  })
  return {...session, project}
}
