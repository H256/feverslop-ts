import {computed, ref, shallowRef} from 'vue'
import type {EditorProject, ProjectKind, ProjectStatus, QueuedRun, RunInfo, RunRequest} from '../../../../shared/workspace'
import {projectApi} from '../../api/project'
import {projectRoot, rootsOf} from '../../api/urls'
import type {Ask} from '../../services/ask'
import type {RunDock} from '../../services/run'
import type {Toasts} from '../../services/toasts'
import {defineService} from '../../services/service'
import type {Servers} from '../../services/servers'

/**
 * One project while its pages are open: its endpoints, its media roots, the snapshot of /api/project and its runs. Made by
 * ProjectLayout for one (kind, id); another project is another session.
 */
export function createProjectSession(kind: ProjectKind, id: string, deps: {run: RunDock; servers: Servers; ask?: Ask['ask']; toasts?: Toasts}) {
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
  const start = (action: RunRequest) =>
    startVia(queue => (queue ? api.runOrQueue(action, deps.servers.take()) : api.run(action, deps.servers.take())), {action})
  /**
   * Starts a run - with start() for what was asked, or through a route of its own (a picture rendered again from an edited prompt, an
   * uploaded anchor): while a run goes on, it is asked whether this one is to wait behind it (#837) - a file in logs/, started by the
   * workspace as the project is free - and `call` is told to queue it. `asked`: the question of the caller said so already, the run is
   * queued without another one.
   */
  async function startVia(
    call: (queue: boolean) => Promise<{run: RunInfo} | {queued: QueuedRun}>,
    {action, asked = false}: {action?: RunRequest; asked?: boolean} = {},
  ) {
    const started = deps.run.starter()
    const queue = deps.run.running()
    if (queue && !asked) {
      if (!deps.ask) throw new Error('a run is going on - wait for it, or stop it')
      const yes = await deps.ask({title: 'Start it after this run?', lines: queueLines(), confirm: 'Put it in the queue'})
      if (!yes) return
    }
    const answer = await call(queue)
    if ('run' in answer) started(answer.run, action)
    else {
      deps.toasts?.show(`Queued: ${answer.queued.command}`)
      deps.run.readHistory()
    }
  }
  /** What waiting behind the run that goes on means - said by start(), and by a question that asks for a run in its own words. */
  const queueLines = () => [
    `A run is going on: ${deps.run.current.value?.command ?? ''}`,
    'This one waits in the queue of the project and starts as soon as the project is free - also when the workspace was started again in between. It can be taken out in the run bar, or with bun run runs.',
  ]
  /**
   * A change that the server follows with a run of its own - the direction taken and the clip prompts built again (#830): one request,
   * and the run it answers with is followed like one started here. `rebuild` is what the request is given to start that run with.
   */
  const changing = async <T extends {run?: RunInfo}>(change: (rebuild: {servers?: string[]}) => Promise<T>): Promise<T> => {
    if (deps.run.running()) throw new Error('a run is going on - wait for it, or stop it')
    const started = deps.run.starter()
    const servers = deps.servers.take()
    const done = await change(servers ? {servers} : {})
    if (done.run) started(done.run, {type: 'plan'})
    return done
  }
  const busy = computed(() => !!deps.run.current.value?.running)
  /** What `bun run status` says of the project - its steps and the next one: the tabs and the next-step bar read it (#833). */
  const status = shallowRef<ProjectStatus>()
  const loadStatus = () =>
    api
      .status()
      .then(found => {
        status.value = found
      })
      .catch(() => {})
  return {
    kind,
    id,
    root,
    api,
    roots: rootsOf(root),
    project,
    error,
    reload,
    start,
    startVia,
    queueLines,
    running: deps.run.running,
    changing,
    starter: deps.run.starter,
    busy,
    takeServers: deps.servers.take,
    status,
    loadStatus,
  }
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
