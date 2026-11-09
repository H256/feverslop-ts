import {onScopeDispose, ref, shallowRef} from 'vue'
import type {RunInfo, RunLines, RunRequest} from '../../../shared/workspace'
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
  const scope = shallowRef<RunScope>()
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
    events.addEventListener('state', event => {
      const state = JSON.parse((event as MessageEvent<string>).data) as RunInfo | null
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
    scope.value = next
    after = 0
    log.value = ''
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
  return {current, log, logOpen, closed, detail, scope, follow, starter, onEnd, running, dispose}
}
export type RunDock = ReturnType<typeof createRunDock>
export const RunService = defineService<RunDock>('run')
export const useRunDock = RunService.use
