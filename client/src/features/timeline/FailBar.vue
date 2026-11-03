<script setup lang="ts">
import {computed, ref} from 'vue'
import {useTimeline} from './context'

/** A run that did not finish, in words, with what to do - where what went wrong can be told surely. Closed, it stays closed this session. */
const {project, session, actions} = useTimeline()
const key = `dismissed:${session.kind}/${session.id}`
const dismissed = ref(sessionStorage.getItem(key))
const last = computed(() => project.value.lastRun)
const said = computed(() => last.value && (last.value.state === 'failed' || last.value.state === 'stopped') ? last.value.explained : [])
const shown = computed(() => said.value.length > 0 && dismissed.value !== last.value?.startedAt)
const dismiss = () => {
  if (!last.value) return
  sessionStorage.setItem(key, last.value.startedAt)
  dismissed.value = last.value.startedAt
}
</script>

<template>
  <div v-if="shown && last" class="failbar">
    <span :title="last.failures.join('\n')">{{ said.map(found => `${found.text} ${found.action}`).join(' ') }}</span>
    <div class="spacer" />
    <button class="btn" @click="actions.repeatLast(last)">Repeat</button>
    <button class="btn" aria-label="Close" @click="dismiss">✕</button>
  </div>
</template>
