<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import type {NewView} from './forms'

/** The fields of one more view, filled into the caller's reactive draft - the question reads it when it is answered. */
defineProps<{draft: NewView}>()
</script>

<template>
  <div>
    <FormField label="Where the camera is"><input v-model="draft.name" type="text" placeholder="behind the bar, looking at the door" required></FormField>
    <FormField label="What it shows"><textarea v-model="draft.shows" rows="3" placeholder="What is seen from there" /></FormField>
  </div>
</template>
