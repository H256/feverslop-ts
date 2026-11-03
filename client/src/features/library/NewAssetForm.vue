<script setup lang="ts">
import FormField from '../../components/FormField.vue'

/** What a new asset is made from: the picture, its kind and id, and what can be said of it. */
export type NewAsset = {file?: File, kind: 'character' | 'location', id: string, name: string, role: string, description: string}
const asset = defineModel<NewAsset>({required: true})
const picked = (event: Event) => { asset.value.file = (event.target as HTMLInputElement).files?.[0] }
</script>

<template>
  <div>
    <FormField label="Picture"><input type="file" accept="image/*" required @change="picked"></FormField>
    <FormField label="Kind"><select v-model="asset.kind"><option value="character">Character</option><option value="location">Place</option></select></FormField>
    <FormField label="Library id"><input v-model="asset.id" type="text" placeholder="kael-red"></FormField>
    <FormField label="Name"><input v-model="asset.name" type="text" placeholder="Optional"></FormField>
    <FormField label="Role"><input v-model="asset.role" type="text" placeholder="Optional, e.g. lead singer"></FormField>
    <FormField label="Description"><textarea v-model="asset.description" rows="3" placeholder="Optional - without it a vision model describes the picture" /></FormField>
  </div>
</template>
