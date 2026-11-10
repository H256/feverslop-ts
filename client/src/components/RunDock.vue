<script setup lang="ts">
import {computed, nextTick, onScopeDispose, ref, watch} from 'vue'
import {useAsk} from '../services/ask'
import {failedRun, runStateText, useRunDock} from '../services/run'
import {useToasts} from '../services/toasts'

/** What goes on, at the foot of every page: the run, its log, and stopping it. */
const run = useRunDock()
const ask = useAsk()
const toasts = useToasts()
const logBox = ref<HTMLPreElement>()
const shown = computed(() => (run.current.value && !run.closed.value ? run.current.value : undefined))
const state = computed(() => shown.value && runStateText(shown.value))

// how far the run is (#775): a render of clips as a bar, any other run by the step of its log - and the time it runs or ran
const now = ref(Date.now())
const ticker = setInterval(() => {
  if (run.current.value?.running) now.value = Date.now()
}, 1000)
onScopeDispose(() => clearInterval(ticker))
// why a run failed, in the bar - also with the log folded (#797): the CLI prints it right after "✗ FAILED", before its "Help:" line
const reason = computed(() => {
  if (!shown.value || !failedRun(shown.value)) return ''
  // eslint-disable-next-line no-control-regex -- the colours of the terminal
  const plain = run.log.value.replace(/\u001b\[[0-9;]*m/g, '')
  const at = plain.lastIndexOf('FAILED')
  if (at < 0) return ''
  return plain
    .slice(at + 'FAILED'.length)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('Help:') && !line.startsWith('▸'))
    .slice(0, 3)
    .join(' ')
})
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
  <section v-if="shown" class="rundock" aria-label="Run">
    <div class="runbar">
      <span :class="['dot', {failed: failedRun(shown), done: !shown.running && !failedRun(shown)}]" />
      <span>{{ state }}</span>
      <span v-if="progress" class="runprogress" :title="`${progress.done} of ${progress.total} clips done`">
        <span class="track"><span class="fill" :style="{width: `${percent}%`}" /></span>
        <b class="num">{{ progress.done }}/{{ progress.total }}</b
        ><span class="num muted">{{ percent }}%</span>
      </span>
      <span v-else-if="shown.running && run.step.value" class="runstep" title="The step of the run, from its log">{{ run.step.value }}</span>
      <span v-if="elapsed" class="num muted" :title="shown.running ? 'Running for' : 'Took'">{{ elapsed }}</span>
      <span v-if="reason" class="runreason" :title="reason">{{ reason }}</span>
      <code v-else>{{ shown.command }}</code>
      <div class="spacer" />
      <button class="btn" :aria-expanded="run.logOpen.value" @click="run.logOpen.value = !run.logOpen.value">Log</button>
      <button v-if="shown.running && run.scope.value?.stop" class="btn danger" @click="stop">Stop</button>
      <button v-if="!shown.running" class="btn" aria-label="Close" @click="run.closed.value = true">✕</button>
    </div>
    <pre v-show="run.logOpen.value" ref="logBox" class="runlog">{{ run.log.value }}</pre>
  </section>
</template>
