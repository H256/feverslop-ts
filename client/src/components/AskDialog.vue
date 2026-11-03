<script setup lang="ts">
import {computed, ref} from 'vue'
import type {AskRequest} from '../services/ask'
import {useServers} from '../services/servers'
import ModalDialog from './ModalDialog.vue'
import ServerPick from './ServerPick.vue'

/** The question of AskService: what it does and what it costs, warnings, its own form, the servers for GPU work. */
const props = defineProps<{request: AskRequest}>()
const servers = useServers()
const chosen = ref<string[]>(props.request.render ? servers.preselected() : [])
const modal = ref<InstanceType<typeof ModalDialog>>()
const lines = computed(() => (props.request.lines ?? []).filter((line): line is string => !!line))
const warnings = computed(() => (props.request.warnings ?? []).filter((line): line is string => !!line))
let answered = false
const answer = (yes: boolean) => {
  if (answered) return
  answered = true
  if (yes && props.request.render) servers.choose(chosen.value)
  props.request.answer(yes)
  modal.value?.close()
}
</script>

<template>
  <ModalDialog ref="modal" class="ask" :label="request.title" @close="answer(false)">
    <h2>{{ request.title }}</h2>
    <p v-for="line in lines" :key="line" class="muted">{{ line }}</p>
    <div v-for="line in warnings" :key="line" class="warn">{{ line }}</div>
    <!-- the form of the question is made by its asker, a functional component -->
    <component :is="request.body" v-if="request.body" />
    <ServerPick v-if="request.render" v-model="chosen" />
    <div class="btn-row">
      <button class="btn" @click="answer(false)">Cancel</button>
      <button :class="['btn', request.danger ? 'danger' : 'primary']" @click="answer(true)">{{ request.confirm }}</button>
    </div>
  </ModalDialog>
</template>
