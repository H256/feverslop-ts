<script setup lang="ts">
import type {CastMember} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'

/** One member of the cast by hand: its name and texts. What a film's role has differs from a music video's. */
export type DraftMember = Partial<CastMember> & {name: string}
defineProps<{kind: 'character' | 'location', film: boolean, removable: boolean}>()
const member = defineModel<DraftMember>({required: true})
defineEmits<{remove: []}>()
</script>

<template>
  <article class="member">
    <div class="head">
      <b>{{ member.id ?? 'new' }}</b>
      <span v-if="member.group" class="chip" title="A group character: several people of one kind. Its members are kept as they are.">Group</span>
      <span v-if="member.voiceOnly" class="chip" title="Never on screen">Voice only</span>
      <div class="spacer" />
      <button v-if="removable" class="btn" :title="kind === 'character' ? 'Out of the cast: the beats and shots are planned without them' : 'Out of the cast: the beats are planned without it'" @click="$emit('remove')">Remove</button>
    </div>
    <FormField label="Name"><input v-model="member.name" type="text" aria-label="Name"></FormField>
    <template v-if="kind === 'character'">
      <FormField label="Role in the story"><textarea v-model="member.role" rows="2" aria-label="Role in the story" /></FormField>
      <template v-if="film">
        <FormField v-if="!member.voiceOnly" label="Appearance"><textarea v-model="member.appearance" rows="3" aria-label="Appearance" /></FormField>
        <FormField label="Voice"><input v-model="member.voice" type="text" aria-label="Voice"></FormField>
      </template>
      <FormField v-else label="Prop (optional)"><input v-model="member.prop" type="text" aria-label="Prop (optional)" placeholder="What they carry or play - an instrument, a lantern"></FormField>
    </template>
    <FormField v-else-if="film" label="Description"><textarea v-model="member.description" rows="3" aria-label="Description" /></FormField>
  </article>
</template>
