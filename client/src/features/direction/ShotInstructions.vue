<script setup lang="ts">
import {computed, ref} from 'vue'
import type {DirectionRule, DirectionShot} from '../../../../shared/direction'

/**
 * The instructions of one shot (#839): those saved, and a new one for the whole shot or one person - saved and proposed in one step
 * (the language model writes the shot anew), or saved only. `writeIns`: people a direct edit left without words, written by a proposal.
 */
const props = defineProps<{
  shotId: string
  shot: DirectionShot
  rules: DirectionRule[]
  blocked: boolean
  busy: boolean
  writeIns: number
  name: (id: string) => string
  /** saves the instruction, and asks the language model when `propose`; true when it went through */
  save: (rule: DirectionRule, propose: boolean) => Promise<boolean>
}>()
defineEmits<{remove: [DirectionRule]; propose: []}>()

const text = ref('')
const forWhom = ref('')
const box = ref<HTMLTextAreaElement>()
const send = async (propose: boolean) => {
  const rule: DirectionRule = {
    id: crypto.randomUUID(),
    text: text.value.trim(),
    scope: {kind: 'shot', id: props.shotId},
    ...(forWhom.value ? {characterId: forWhom.value} : {}),
  }
  if (await props.save(rule, propose)) text.value = ''
}
const hint = computed(() => {
  if (props.busy) return 'A run is going on…'
  const who = forWhom.value ? `for ${props.name(forWhom.value)}` : 'for the whole shot'
  const also = props.writeIns ? ' It also writes in what the direct edits above leave open.' : ''
  return text.value.trim()
    ? `Saves the instruction ${who}, then the language model writes the shot anew.${also} Nothing is rendered.`
    : props.writeIns
      ? 'The language model writes in what the direct edits above leave open. Nothing is rendered.'
      : 'Write an instruction; the language model writes the shot anew. Nothing is rendered.'
})
/** The instruction box set to one person, and focused - it is below the people. */
const focusFor = (id: string) => {
  forWhom.value = id
  box.value?.focus()
  box.value?.scrollIntoView({block: 'nearest'})
}
defineExpose({focusFor})
</script>

<template>
  <section class="list">
    <h3>Instructions</h3>
    <div v-for="r in rules" :key="r.id" class="row">
      <span>{{ r.characterId ? `${name(r.characterId)}: ` : '' }}{{ r.text }}</span
      ><button class="btn" :disabled="blocked" @click="$emit('remove', r)">Remove</button>
    </div>
    <label class="instruction-for"
      >New instruction for
      <select v-model="forWhom" :disabled="blocked">
        <option value="">the whole shot</option>
        <option v-for="id in shot.characters" :key="id" :value="id">{{ name(id) }}</option>
      </select>
    </label>
    <label class="instruction">
      <span class="sr-only">Instruction</span>
      <textarea
        ref="box"
        v-model="text"
        rows="3"
        :placeholder="
          forWhom
            ? `${name(forWhom)} turns toward his own left, ending with his back to the camera.`
            : 'The camera stays low; everyone keeps still while the light changes.'
        "
      />
    </label>
    <div class="btn-row propose">
      <button class="btn primary" :disabled="blocked || (!text.trim() && !writeIns)" @click="text.trim() ? send(true) : $emit('propose')">
        {{ text.trim() ? 'Save and propose' : 'Propose' }}
      </button>
      <button v-if="text.trim()" class="btn" :disabled="blocked" title="Saved with the others; proposed with the next Propose" @click="send(false)">
        Save only
      </button>
      <span class="muted">{{ hint }}</span>
    </div>
  </section>
</template>

<style scoped>
h3 {
  margin: 22px 0 8px;
  font-size: var(--text-s);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.list .row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 7px 0;
  border-top: 1px solid var(--line);
  line-height: 1.4;
}
.list .row:first-of-type {
  border-top: 0;
}
.list .row > span {
  flex: 1;
}
.instruction-for {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: 12px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.instruction {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: 12px;
}
.instruction textarea {
  width: 100%;
}
.propose {
  align-items: center;
  margin-top: 8px;
}
</style>
