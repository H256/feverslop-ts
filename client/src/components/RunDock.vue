<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'
import {useAsk} from '../services/ask'
import {failedRun, runStateText, useRunDock} from '../services/run'
import {useToasts} from '../services/toasts'

/** What goes on, at the foot of every page: the run, its log, and stopping it. */
const run = useRunDock()
const ask = useAsk()
const toasts = useToasts()
const logBox = ref<HTMLPreElement>()
const shown = computed(() => (run.current.value && !run.closed.value ? run.current.value : undefined))
const state = computed(() => shown.value && `${runStateText(shown.value)}${shown.value.running && run.detail.value ? `: ${run.detail.value}` : ''}`)

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
      <code>{{ shown.command }}</code>
      <div class="spacer" />
      <button class="btn" :aria-expanded="run.logOpen.value" @click="run.logOpen.value = !run.logOpen.value">Log</button>
      <button v-if="shown.running && run.scope.value?.stop" class="btn danger" @click="stop">Stop</button>
      <button v-if="!shown.running" class="btn" aria-label="Close" @click="run.closed.value = true">✕</button>
    </div>
    <pre v-show="run.logOpen.value" ref="logBox" class="runlog">{{ run.log.value }}</pre>
  </section>
</template>
