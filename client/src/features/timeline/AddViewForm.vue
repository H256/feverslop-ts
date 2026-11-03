<script setup lang="ts">
import FormField from '../../components/FormField.vue'

/** One more view of a place: where the camera is, and what it shows. */
export type NewView = {name: string, shows: string}
const view = defineModel<NewView>({required: true})
</script>

<template>
  <div>
    <FormField label="Where the camera is"><input v-model="view.name" type="text" placeholder="behind the bar, looking at the door"></FormField>
    <FormField label="What it shows"><textarea v-model="view.shows" rows="3" placeholder="What is seen from there" /></FormField>
  </div>
</template>
