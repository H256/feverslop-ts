<script setup lang="ts">
import {computed, ref} from 'vue'
import {errorText} from '../lib/format'
import type {AskRequest} from '../services/ask'
import {useServers} from '../services/servers'
import ModalDialog from './ModalDialog.vue'
import ServerPick from './ServerPick.vue'

/**
 * The question of AskService: what it does and what it costs, warnings, its own form, the servers for GPU work. The question is a form:
 * what its fields require is checked before it is answered. With a `submit` of its own the question stays open until that is done - a
 * refusal is said here, with everything filled in still there.
 */
const props = defineProps<{request: AskRequest}>()
const servers = useServers()
const chosen = ref<string[]>(props.request.render ? servers.preselected() : [])
const modal = ref<InstanceType<typeof ModalDialog>>()
const lines = computed(() => (props.request.lines ?? []).filter((line): line is string => !!line))
const warnings = computed(() => (props.request.warnings ?? []).filter((line): line is string => !!line))
const pending = ref(false)
const failure = ref('')
let answered = false
const finish = (yes: boolean) => {
  if (answered) return
  answered = true
  props.request.answer(yes)
  modal.value?.close()
}
const cancel = () => {
  if (!pending.value) finish(false)
}
async function confirm() {
  if (pending.value || answered) return
  if (props.request.render) servers.choose(chosen.value)
  if (!props.request.submit) return finish(true)
  pending.value = true
  failure.value = ''
  try {
    await props.request.submit()
    finish(true)
  } catch (cause) {
    failure.value = errorText(cause)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <ModalDialog ref="modal" class="ask" :label="request.title" :locked="pending" @close="cancel">
    <form :aria-busy="pending" @submit.prevent="confirm">
      <h2>{{ request.title }}</h2>
      <p v-for="line in lines" :key="line" class="muted">{{ line }}</p>
      <div v-for="line in warnings" :key="line" class="warn">{{ line }}</div>
      <!-- the form of the question is made by its asker, a functional component -->
      <fieldset v-if="request.body" :disabled="pending" class="plain"><component :is="request.body" /></fieldset>
      <ServerPick v-if="request.render" v-model="chosen" />
      <div v-if="failure" role="alert" class="warn bad">{{ failure }}</div>
      <div class="btn-row">
        <button type="button" class="btn" :disabled="pending" @click="cancel">Cancel</button>
        <button type="submit" :class="['btn', request.danger ? 'danger' : 'primary']" :disabled="pending">{{ pending ? 'Working…' : request.confirm }}</button>
      </div>
    </form>
  </ModalDialog>
</template>
