<script setup lang="ts">
import {h, reactive} from 'vue'
import type {AssetKind} from '../../../../shared/workspace'
import {workspace} from '../../api/workspace'
import FormField from '../../components/FormField.vue'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'

/**
 * An entry of the library renamed, described anew or put away - what `bun run library rename|describe|remove` does (#835), each
 * asked first. Put away: into the library's .trash/, never deleted, and refused while a project casts it.
 */
const props = defineProps<{kind: AssetKind | 'song'; id: string; name: string; description?: string}>()
const emit = defineEmits<{changed: []}>()
const ask = useAsk()
const toasts = useToasts()

const rename = toasts.guard(async () => {
  const draft = reactive({name: props.name})
  const yes = await ask({
    title: `Rename ${props.name}`,
    lines: [`The id stays ${props.id}: the projects name it by that.`, `bun run library rename ${props.kind} ${props.id} <name>`],
    body: () =>
      h(FormField, {label: 'Name'}, () =>
        h('input', {type: 'text', value: draft.name, onInput: (e: Event) => (draft.name = (e.target as HTMLInputElement).value)}),
      ),
    confirm: 'Rename',
    submit: () => workspace.changeLibrary({action: 'rename', kind: props.kind, id: props.id, name: draft.name}),
  })
  if (yes) emit('changed')
})

const describe = toasts.guard(async () => {
  if (props.kind === 'song') return
  const kind = props.kind
  const draft = reactive({description: props.description ?? ''})
  const yes = await ask({
    title: `Describe ${props.name} anew`,
    lines: ['What the clip prompts say it looks like. A project that took it keeps its copy until it takes it again.'],
    body: () =>
      h(FormField, {label: 'Description'}, () =>
        h('textarea', {rows: 6, value: draft.description, onInput: (e: Event) => (draft.description = (e.target as HTMLTextAreaElement).value)}),
      ),
    confirm: 'Save',
    submit: () => workspace.changeLibrary({action: 'describe', kind, id: props.id, description: draft.description}),
  })
  if (yes) emit('changed')
})

const remove = toasts.guard(async () => {
  const yes = await ask({
    title: `Take ${props.name} out of the library?`,
    lines: [
      "It is put away into the library's .trash folder, not deleted. Projects that took it keep their copy.",
      `bun run library remove ${props.kind} ${props.id}`,
    ],
    confirm: 'Put it away',
    danger: true,
    submit: () => workspace.changeLibrary({action: 'remove', kind: props.kind, id: props.id}),
  })
  if (yes) emit('changed')
})
</script>

<template>
  <div class="btn-row la-actions">
    <button class="btn" @click="rename">Rename</button>
    <button v-if="kind !== 'song'" class="btn" @click="describe">Describe anew</button>
    <button class="btn danger" @click="remove">Remove</button>
  </div>
</template>

<style scoped>
.la-actions {
  margin: 8px 0 12px;
}
</style>
