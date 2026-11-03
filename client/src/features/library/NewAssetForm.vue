<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import type {NewAsset} from './forms'

/** The fields of a new asset, filled into the caller's reactive draft - the question reads it when it is answered. */
const props = defineProps<{draft: NewAsset}>()
const picked = (event: Event) => { props.draft.file = (event.target as HTMLInputElement).files?.[0] }
</script>

<template>
  <div>
    <FormField label="Picture"><input type="file" accept="image/*" required @change="picked"></FormField>
    <FormField label="Kind"><select v-model="draft.kind"><option value="character">Character</option><option value="location">Place</option></select></FormField>
    <FormField label="Library id"><input v-model="draft.id" type="text" placeholder="kael-red"></FormField>
    <FormField label="Name"><input v-model="draft.name" type="text" placeholder="Optional"></FormField>
    <FormField label="Role"><input v-model="draft.role" type="text" placeholder="Optional, e.g. lead singer"></FormField>
    <FormField label="Description"><textarea v-model="draft.description" rows="3" placeholder="Optional - without it a vision model describes the picture" /></FormField>
  </div>
</template>
