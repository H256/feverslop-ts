import {computed, ref, shallowRef} from 'vue'
import type {EditorProject, ProjectKind, RunInfo, RunRequest} from '../../../../shared/workspace'
import {projectApi} from '../../api/project'
import {projectRoot, rootsOf} from '../../api/urls'
import type {RunDock} from '../../services/run'
import {defineService} from '../../services/service'
import type {Servers} from '../../services/servers'

/**
 * One project while its pages are open: its endpoints, its media roots, the snapshot of /api/project and its runs. Made by
 * ProjectLayout for one (kind, id); another project is another session.
 */
export function createProjectSession(kind: ProjectKind, id: string, deps: {run: RunDock, servers: Servers}) {
  const root = projectRoot({kind, id})
  const api = projectApi(root)
  const project = shallowRef<EditorProject>()
  const error = ref('')
  let text = ''

  /** The folder is the model: read again, and taken over only when it changed. True when it did. */
  const reload = async (signal?: AbortSignal) => {
    const next = await api.projectText(signal)
    if (next === text) return false
    text = next
    project.value = JSON.parse(next) as EditorProject
    return true
  }
  /** Starts a run for what was asked - after the question, with the servers chosen in it. */
  const start = async (action: RunRequest) => {
    if (deps.run.running()) throw new Error('a run is going on - wait for it, or stop it')
    const {run} = await api.run(action, deps.servers.take())
    deps.run.started(run, action)
  }
  /** A run started by a route of its own (a picture rendered again with its prompt). */
  const started = (run: RunInfo) => deps.run.started(run)
  const busy = computed(() => !!deps.run.current.value?.running)
  return {kind, id, root, api, roots: rootsOf(root), project, error, reload, start, started, busy, takeServers: deps.servers.take}
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
