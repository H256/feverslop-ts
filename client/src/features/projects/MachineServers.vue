<script setup lang="ts">
import {onMounted, reactive, shallowRef} from 'vue'
import type {SetupChange, SetupView} from '../../../../shared/workspace'
import {workspace} from '../../api/workspace'
import FormField from '../../components/FormField.vue'
import {errorText} from '../../lib/format'

/**
 * The servers of this machine, set here (#831): the language model, the model that reads pictures and the ComfyUI servers - each
 * change is `bun run setup <command> --…` (#827), the same as in the terminal. A server from an environment variable beats the file.
 */
const emit = defineEmits<{changed: []}>()
const view = shallowRef<SetupView>()
const said = shallowRef<string[]>([])
const failed = shallowRef('')
const pending = shallowRef(false)
const llm = reactive({url: '', model: '', key: ''})
const vision = reactive({url: '', model: ''})
const comfy = reactive({add: '', name: ''})

const load = async () => {
  const found = await workspace.setup()
  view.value = found
  llm.url = found.llm.url ?? ''
  llm.model = found.llm.model ?? ''
  vision.url = found.llm.vision?.url ?? ''
  vision.model = found.llm.vision?.model ?? ''
}
onMounted(() => void load().catch(e => (failed.value = errorText(e))))

const change = async (asked: SetupChange) => {
  pending.value = true
  failed.value = ''
  try {
    said.value = (await workspace.changeSetup(asked)).said
    await load()
    emit('changed')
  } catch (e) {
    failed.value = errorText(e)
  } finally {
    pending.value = false
  }
}
const fromEnv = (source?: string) => source && source !== 'file' && source !== 'default'
</script>

<template>
  <section class="ms" aria-label="Servers">
    <h3>Servers</h3>
    <p v-if="!view && !failed" class="muted">Reading the settings…</p>
    <template v-if="view">
      <div class="ms-row">
        <FormField label="Language model server (with /v1)"><input v-model="llm.url" type="text" placeholder="http://localhost:8080/v1" /></FormField>
        <FormField label="Model (empty: the server's only one)"><input v-model="llm.model" type="text" /></FormField>
        <FormField :label="view.llm.apiKey ? `API key (${view.llm.apiKey} - empty keeps it)` : 'API key (if it needs one)'"
          ><input v-model="llm.key" type="password" autocomplete="off"
        /></FormField>
        <button type="button" class="btn" :disabled="pending || !llm.url.trim()" @click="change({command: 'llm', options: {url: llm.url, model: llm.model, ...(llm.key ? {key: llm.key} : {})}})">Save</button>
        <p v-if="fromEnv(view.sources.llmUrl)" class="warn ms-wide">Set by {{ view.sources.llmUrl }} - it beats what is saved here.</p>
      </div>
      <div class="ms-row">
        <FormField label="Server that reads pictures (empty: the language model server)"><input v-model="vision.url" type="text" /></FormField>
        <FormField label="Its model"><input v-model="vision.model" type="text" /></FormField>
        <button type="button" class="btn" :disabled="pending || (!vision.url.trim() && !vision.model.trim())" @click="change({command: 'vision', options: {url: vision.url || '-', model: vision.model}})">Save</button>
        <button v-if="view.llm.vision" type="button" class="btn" :disabled="pending" @click="change({command: 'vision', options: {off: true}})">
          The text model reads them
        </button>
      </div>
      <div class="ms-comfy">
        <b>ComfyUI</b>
        <span v-if="fromEnv(view.sources.comfy)" class="warn">Set by {{ view.sources.comfy }} - it beats what is saved here.</span>
        <ul>
          <li v-for="server in view.comfy" :key="server.url">
            <span>{{ server.name }}</span> <code class="muted">{{ server.url }}</code>
            <button type="button" class="btn mini" :disabled="pending" @click="change({command: 'comfy', options: {remove: server.name}})">Remove</button>
          </li>
        </ul>
        <div class="ms-row">
          <FormField label="Add a server"><input v-model="comfy.add" type="text" placeholder="http://gpu1.lan:8188" /></FormField>
          <FormField label="Name (optional)"><input v-model="comfy.name" type="text" /></FormField>
          <button type="button" class="btn" :disabled="pending || !comfy.add.trim()" @click="change({command: 'comfy', options: {add: comfy.add, name: comfy.name}})">Add</button>
        </div>
      </div>
    </template>
    <p v-for="line in said" :key="line" class="muted ms-said">{{ line }}</p>
    <p v-if="failed" class="warn">{{ failed }}</p>
    <p class="muted ms-said">The same as <code>bun run setup llm|vision|comfy --…</code>; saved in <code>{{ view?.file }}</code>.</p>
  </section>
</template>

<style scoped>
.ms {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.ms h3 {
  margin: 0;
}
.ms-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: flex-end;
}
.ms-row > :deep(*) {
  min-width: 0;
}
.ms-wide {
  flex-basis: 100%;
  margin: 0;
}
.ms-comfy ul {
  list-style: none;
  margin: var(--space-1) 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}
.ms-said {
  margin: 0;
  font-size: var(--text-s);
}
</style>
