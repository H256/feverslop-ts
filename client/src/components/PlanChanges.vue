<script setup lang="ts">
/**
 * What a change on the page does when saved, and the buttons that save it: the foot of the Singers and the Timing page alike. Without
 * changes it says what a change would do, or offers the plan run that unplanned beats wait for.
 */
defineProps<{
  count: string
  effects: string[]
  warning?: string
  blocked?: string
  saved?: string
  unplanned: string[]
  idle: string
  keptIn: string
  busy: boolean
}>()
defineEmits<{discard: []; save: []; saveAndPlan: []; plan: []}>()
</script>

<template>
  <div class="changes">
    <div v-if="saved" class="note">{{ saved }}</div>
    <template v-if="count">
      <b>{{ count }}</b>
      <ul>
        <li v-for="effect in effects" :key="effect">{{ effect }}</li>
      </ul>
      <slot name="warning" />
      <div class="btn-row">
        <button class="btn" @click="$emit('discard')">Discard</button>
        <button class="btn" :disabled="!!blocked" :title="blocked" @click="$emit('save')">Save</button>
        <button class="btn primary" :disabled="!!blocked" :title="blocked || 'Save, then plan the shots of these beats again'" @click="$emit('saveAndPlan')">
          Save and plan
        </button>
      </div>
      <slot name="more" />
    </template>
    <template v-else>
      <p class="muted">
        {{
          unplanned.length
            ? `${unplanned.join(', ')} ${unplanned.length > 1 ? 'have' : 'has'} no shot plan: the next plan run plans ${unplanned.length > 1 ? 'them' : 'it'}.`
            : idle
        }}
      </p>
      <button v-if="unplanned.length" class="btn primary" :disabled="busy" @click="$emit('plan')">Plan now</button>
    </template>
    <p class="muted" style="font-size: var(--text-s); margin-top: 14px">{{ keptIn }}</p>
  </div>
</template>
