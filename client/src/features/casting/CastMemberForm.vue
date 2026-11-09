<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import type {DraftMember} from './forms'

/** One member of the cast by hand, filled into the caller's draft. What a film's role has differs from a music video's. */
defineProps<{draft: DraftMember; kind: 'character' | 'location'; film: boolean; removable: boolean}>()
defineEmits<{remove: []}>()
</script>

<template>
  <article class="member">
    <div class="head">
      <b>{{ draft.id ?? 'new' }}</b>
      <span v-if="draft.group" class="chip" title="A group character: several people of one kind. Its members are kept as they are.">Group</span>
      <span v-if="draft.voiceOnly" class="chip" title="Never on screen">Voice only</span>
      <div class="spacer" />
      <button
        v-if="removable"
        class="btn"
        :title="kind === 'character' ? 'Out of the cast: the beats and shots are planned without them' : 'Out of the cast: the beats are planned without it'"
        @click="$emit('remove')"
      >
        Remove
      </button>
    </div>
    <FormField label="Name"><input v-model="draft.name" type="text" aria-label="Name" /></FormField>
    <template v-if="kind === 'character'">
      <FormField label="Role in the story"><textarea v-model="draft.role" rows="2" aria-label="Role in the story" /></FormField>
      <template v-if="film">
        <FormField v-if="!draft.voiceOnly" label="Appearance"><textarea v-model="draft.appearance" rows="3" aria-label="Appearance" /></FormField>
        <FormField label="Voice"><input v-model="draft.voice" type="text" aria-label="Voice" /></FormField>
      </template>
      <FormField v-else label="Prop (optional)"
        ><input v-model="draft.prop" type="text" aria-label="Prop (optional)" placeholder="What they carry or play - an instrument, a lantern"
      /></FormField>
    </template>
    <FormField v-else-if="film" label="Description"><textarea v-model="draft.description" rows="3" aria-label="Description" /></FormField>
  </article>
</template>
