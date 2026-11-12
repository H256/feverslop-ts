import {computed, onScopeDispose, ref, shallowRef} from 'vue'
import type {ClipProgress, RunEvent, RunEvents, RunInfo, RunLines, RunProgress, RunRequest} from '../../../shared/workspace'
import {defineService} from './service'
import type {Toasts} from './toasts'

const LOG_MOST = 400_000
const LOG_KEPT = 200_000

/** Whose runs are followed: a project's, or the library's - where its events come from and how it is stopped. */
export type RunScope = {
  events: string
  stop?: () => Promise<unknown>
  said?: {done: string; failed: string}
}
export type RunEnd = (current: RunInfo | null, action: RunRequest | undefined) => void

/**
 * What the events of a run say (#829): the step it is at - the last one begun or taken from the project -, its warnings, why it
 * failed and what to do, and whether it ended well. Events from before `since` (the start of the run followed) belong to another.
 */
export type RunSaid = {step: string; warnings: string[]; failure?: {message: string; advice?: string}; done?: {output?: string; next?: string}}
export function runSaid(events: RunEvent[], since = 0): RunSaid {
  const said: RunSaid = {step: '', warnings: []}
  for (const event of events) {
    if (event.at < since) continue
    if (event.type === 'step' && event.state !== 'done') said.step = event.title
    if (event.type === 'warning') said.warnings.push(event.message)
    if (event.type === 'failed') said.failure = {message: event.message, advice: event.advice}
    if (event.type === 'done') said.done = {output: event.output, next: event.next}
  }
  return said
}
/**
 * How far a render of clips is (#775), from the run's job events (#829): the clips it said it renders, each waiting until its job
 * runs on a server, then done or failed. Undefined for a run that renders no clips. Events from before `since` belong to another run.
 */
export function jobProgress(events: RunEvent[], since = 0): RunProgress | undefined {
  const clips: Record<string, ClipProgress> = {}
  for (const event of events) {
    if (event.at < since) continue
    if (event.type === 'jobs' && event.kind === 'clip') for (const id of event.ids) clips[id] ??= 'waiting'
    if (event.type === 'job' && event.kind === 'clip' && event.id in clips) clips[event.id] = event.state === 'running' ? 'rendering' : event.state
  }
  const states = Object.values(clips)
  return states.length ? {clips, done: states.filter(state => state === 'done').length, total: states.length} : undefined
}
export const failedRun = (run: RunInfo) => !run.running && run.code !== undefined && run.code !== 0
export const runStateText = (run: RunInfo) =>
  run.running ? (run.source === 'terminal' ? 'Running in the terminal' : 'Running') : failedRun(run) ? `Failed (${run.code})` : 'Finished'

/**
 * The run of the page's scope, started here or in the terminal: its state and its log as server-sent events. A new scope (another
 * project, the library) has a cursor of its own; a page that goes stops following, the run itself goes on.
 */
export function createRunDock(toasts: Toasts) {
  const current = shallowRef<RunInfo | null>(null)
  const log = ref('')
  const logOpen = ref(false)
  const closed = ref(false)
  /** A word more on the state, as the timeline knows it: how many clips are done. */
  const detail = ref('')
  /** The events of the run followed (#829), and what they say: its step, warnings and failure. How far a render of clips is; when it ended (#775). */
  const runEvents = shallowRef<RunEvent[]>([])
  // a little before the start the page knows: the clocks of the run and of the editor are the same machine's
  const said = computed(() => {
    const start = Date.parse(current.value?.startedAt ?? '')
    return runSaid(runEvents.value, Number.isNaN(start) ? 0 : start - 5000)
  })
  const step = computed(() => said.value.step)
  // how far a render of clips is - from the job events, while the run goes on (#829)
  const progress = computed(() => {
    if (!current.value?.running) return undefined
    const start = Date.parse(current.value.startedAt)
    return jobProgress(runEvents.value, Number.isNaN(start) ? 0 : start - 5000)
  })
  const endedAt = ref<number>()
  const scope = shallowRef<RunScope>()
  let startedAt: string | undefined
  const ends = new Set<RunEnd>()
  let source: EventSource | undefined
  let after = 0
  let wasRunning = false
  let action: RunRequest | undefined

  const connect = () => {
    source?.close()
    if (!scope.value) return
    const events = new EventSource(`${scope.value.events}?after=${after}`)
    source = events
    events.addEventListener('lines', event => {
      const {lines, next} = JSON.parse((event as MessageEvent<string>).data) as RunLines
      // our own reconnect starts from this cursor, the browser's own sends the id of the last event: nothing comes twice
      after = next
      const text = log.value + lines.join('\n') + '\n'
      log.value = text.length > LOG_MOST ? text.slice(-LOG_KEPT) : text
    })
    events.addEventListener('events', event => {
      const answer = JSON.parse((event as MessageEvent<string>).data) as RunEvents
      // from 0: another run, or the first look - what was there before is not this run's
      runEvents.value = answer.from === 0 ? answer.events : [...runEvents.value, ...answer.events]
    })
    events.addEventListener('state', event => {
      const state = JSON.parse((event as MessageEvent<string>).data) as RunInfo | null
      // another run: its own time
      if (state && state.startedAt !== startedAt) {
        startedAt = state.startedAt
        endedAt.value = undefined
      }
      if (!state?.running && state && endedAt.value === undefined) endedAt.value = Date.now()
      current.value = state
      if (state) closed.value = false
      if (!state?.running) detail.value = ''
      if (state?.running) wasRunning = true
      else if (wasRunning) {
        wasRunning = false
        const said = scope.value?.said ?? {done: 'The run is done', failed: 'The run failed - see the log'}
        toasts.show(!state ? 'The run has ended' : state.code ? said.failed : said.done, !!state?.code)
        if (state?.code) logOpen.value = true
        const asked = action
        action = undefined
        for (const end of ends) end(state, asked)
      }
    })
  }

  /** Follows the runs of a scope while the caller lives. */
  const follow = (next: RunScope) => {
    endedAt.value = undefined
    startedAt = undefined
    scope.value = next
    after = 0
    log.value = ''
    runEvents.value = []
    current.value = null
    wasRunning = false
    // what was asked in another scope is not what ends here
    action = undefined
    connect()
    onScopeDispose(() => {
      if (scope.value !== next) return
      source?.close()
      source = undefined
      scope.value = undefined
      current.value = null
      action = undefined
    })
  }
  /** A run this page just started: its log from the start. */
  const started = (run: RunInfo, asked?: RunRequest) => {
    action = asked
    wasRunning = true
    log.value = ''
    runEvents.value = []
    endedAt.value = undefined
    after = 0
    current.value = run
    closed.value = false
    connect()
  }
  /**
   * Taken before a run is asked for, called with the server's answer: the run is followed only when the scope it was asked in is
   * still the one followed. An answer that comes after the page went (back to a project, on to the library) starts nothing there.
   */
  const starter = () => {
    const asked = scope.value
    return (run: RunInfo, request?: RunRequest) => {
      if (asked && scope.value === asked) started(run, request)
    }
  }
  /** Called when a run of this scope ends, while the caller lives. */
  const onEnd = (end: RunEnd) => {
    ends.add(end)
    onScopeDispose(() => ends.delete(end))
  }
  const running = () => !!current.value?.running
  const dispose = () => {
    source?.close()
    ends.clear()
  }
  return {current, log, logOpen, closed, detail, step, said, progress, endedAt, scope, follow, starter, onEnd, running, dispose}
}
export type RunDock = ReturnType<typeof createRunDock>
export const RunService = defineService<RunDock>('run')
export const useRunDock = RunService.use
