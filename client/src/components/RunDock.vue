<script setup lang="ts">
import CalloutBox from './CalloutBox.vue'
import {computed, nextTick, onScopeDispose, ref, watch} from 'vue'
import {useAsk} from '../services/ask'
import {failedRun, runStateText, useRunDock} from '../services/run'
import {useToasts} from '../services/toasts'
import {plural} from '../lib/format'

/** What goes on, at the foot of every page: the run, its log, and stopping it. */
const run = useRunDock()
const ask = useAsk()
const toasts = useToasts()
const logBox = ref<HTMLPreElement>()
const shown = computed(() => (run.current.value && !run.closed.value ? run.current.value : undefined))
// what waits behind the run, and the runs before it (#837) - the queue keeps the dock open
const queue = computed(() => run.history.value.queue)
const past = computed(() => run.history.value.past)
const pastOpen = ref(false)
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')
const unqueue = toasts.guard(async (id: string) => {
  await run.scope.value?.unqueue?.(id)
  run.readHistory()
})
const state = computed(() => shown.value && runStateText(shown.value))

// how far the run is (#775): a render of clips as a bar, any other run by the step of its log - and the time it runs or ran
const now = ref(Date.now())
const ticker = setInterval(() => {
  if (run.current.value?.running) now.value = Date.now()
}, 1000)
onScopeDispose(() => clearInterval(ticker))
// why a run failed and what to do, in the bar - also with the log folded (#797), from the run's events (#829)
const reason = computed(() => {
  if (!shown.value || !failedRun(shown.value)) return ''
  const failure = run.said.value.failure
  return failure ? [failure.message, failure.advice && `What to do: ${failure.advice}`].filter(Boolean).join(' ') : ''
})
// a run that ended well with warnings says how many, the first ones on a click
const warnings = computed(() => (shown.value && !shown.value.running && !failedRun(shown.value) ? run.said.value.warnings : []))
const progress = computed(() => (shown.value?.running ? run.progress.value : undefined))
const percent = computed(() => (progress.value ? Math.round((progress.value.done / progress.value.total) * 100) : 0))
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`
}
const elapsed = computed(() => {
  const run_ = shown.value
  if (!run_) return ''
  const start = Date.parse(run_.startedAt)
  if (Number.isNaN(start)) return ''
  const end = run_.running ? now.value : (run.endedAt.value ?? now.value)
  return clock(end - start)
})

// the log follows its end only when it was at its end: who scrolled back to read stays there
let atEnd = true
watch(
  run.log,
  () => {
    const box = logBox.value
    atEnd = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 30
    void nextTick(() => {
      if (atEnd && logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
    })
  },
  {flush: 'pre'},
)
watch(run.logOpen, open => {
  if (open)
    void nextTick(() => {
      if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
    })
})

const stop = toasts.guard(async () => {
  const yes = await ask({
    title: 'Stop this run?',
    lines: [run.current.value?.command, 'Finished outputs stay. Jobs already on a server are picked up by the next run.'],
    confirm: 'Stop',
    danger: true,
  })
  if (yes) await run.scope.value?.stop?.()
})
</script>

<template>
  <section v-if="shown || queue.length" class="rundock" aria-label="Run">
    <div v-if="shown" class="runbar">
      <span :class="['dot', {failed: failedRun(shown), done: !shown.running && !failedRun(shown)}]" />
      <span>{{ state }}</span>
      <span v-if="progress" class="runprogress" :title="`${progress.done} of ${progress.total} clips done`">
        <span class="run-track"><span class="run-fill" :style="{width: `${percent}%`}" /></span>
        <b class="num">{{ progress.done }}/{{ progress.total }}</b
        ><span class="num muted">{{ percent }}%</span>
      </span>
      <span v-else-if="shown.running && run.step.value" class="runstep" title="The step the run is at">{{ run.step.value }}</span>
      <span v-if="elapsed" class="num muted" :title="shown.running ? 'Running for' : 'Took'">{{ elapsed }}</span>
      <span v-if="reason" class="runreason" :title="reason">{{ reason }}</span>
      <code v-else>{{ shown.command }}</code>
      <details v-if="warnings.length" class="rd-warnings">
        <summary>{{ plural(warnings.length, 'warning') }}</summary>
        <ul>
          <li v-for="(warning, n) in warnings.slice(0, 5)" :key="n">{{ warning }}</li>
          <li v-if="warnings.length > 5" class="muted">and {{ warnings.length - 5 }} more in the log</li>
        </ul>
      </details>
      <div class="spacer" />
      <button class="btn" :aria-expanded="run.logOpen.value" @click="run.logOpen.value = !run.logOpen.value">Log</button>
      <button v-if="shown.running && run.scope.value?.stop" class="btn danger" @click="stop">Stop</button>
      <button v-if="past.length" class="btn" :aria-expanded="pastOpen" title="The runs that ended: bun run runs" @click="pastOpen = !pastOpen">Runs</button>
      <button v-if="!shown.running" class="btn" aria-label="Close" @click="run.closed.value = true">✕</button>
    </div>
    <ol v-if="queue.length" class="rd-queue" aria-label="Waiting">
      <li v-for="(queued, n) in queue" :key="queued.id">
        <span class="muted">{{ n === 0 ? 'Next' : `${n + 1}.` }}</span>
        <code :title="`asked ${when(queued.askedAt)}`">{{ queued.command }}</code>
        <button class="btn mini" :aria-label="`Take out: ${queued.command}`" title="Take it out of the queue" @click="unqueue(queued.id)">✕</button>
      </li>
    </ol>
    <ol v-if="pastOpen && past.length" class="rd-past" aria-label="Runs that ended">
      <li v-for="(ended, n) in past.slice(0, 10)" :key="n">
        <span :class="['rd-state', ended.state]">{{ ended.state }}</span>
        <span class="num muted">{{ when(ended.startedAt) }}</span>
        <code>{{ ended.command }}</code>
        <CalloutBox v-if="ended.failure" :title="ended.failure" kind="warn" as="span">{{ ended.failure }}</CalloutBox>
        <code v-if="ended.log" class="muted">logs/{{ ended.log }}</code>
      </li>
    </ol>
    <pre v-show="run.logOpen.value" ref="logBox" class="runlog">{{ run.log.value }}</pre>
  </section>
</template>

<style scoped>
/* the queue and the runs before (#837) - rd- names: .queue and .past are not styled elsewhere, kept apart all the same */
.rd-queue,
.rd-past {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border-top: 1px solid var(--line);
  max-height: 30vh;
  overflow: auto;
}
.rd-queue li,
.rd-past li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.rd-queue code,
.rd-past code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.rd-past .ui-callout {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40ch;
}
.rd-state {
  font-size: var(--text-xs);
  min-width: 7ch;
}
.rd-state.failed,
.rd-state.stopped {
  color: var(--stale);
}
</style>
