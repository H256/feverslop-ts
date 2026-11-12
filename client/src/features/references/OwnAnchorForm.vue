<script setup lang="ts">
import {onBeforeUnmount, ref} from 'vue'
import FormField from '../../components/FormField.vue'
import {OWN_ANCHOR_MAX_MB, OWN_ANCHOR_TYPES, type OwnAnchor} from './ownAnchor'

/** The fields of the user's own anchor, filled into the caller's reactive draft - the question reads it when it is answered. */
const props = defineProps<{draft: OwnAnchor; readable: boolean}>()
const preview = ref<string>()
const show = (file: File | undefined) => {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = file ? URL.createObjectURL(file) : undefined
}
const picked = (event: Event) => {
  props.draft.file = (event.target as HTMLInputElement).files?.[0]
  show(props.draft.file)
}
onBeforeUnmount(() => show(undefined))
</script>

<template>
  <div>
    <FormField :label="`Picture - PNG, JPEG or WebP, at most ${OWN_ANCHOR_MAX_MB} MB`"
      ><input type="file" :accept="OWN_ANCHOR_TYPES" required aria-label="Picture" @change="picked"
    /></FormField>
    <img v-if="preview" :src="preview" alt="The picture picked" class="section u-picture" />
    <FormField label="Prompt - kept with the picture as a note"><textarea v-model="draft.prompt" rows="4" aria-label="Prompt of the picture" /></FormField>
    <FormField label="Description - what the clips and the sheet say of it">
      <select v-model="draft.how" aria-label="Description">
        <option value="keep">Keep the one there is</option>
        <option value="text">Write it myself</option>
        <option v-if="readable" value="describe">Read it from the picture (vision model)</option>
      </select>
    </FormField>
    <textarea v-if="draft.how === 'text'" v-model="draft.description" rows="4" aria-label="Description text" />
    <p v-if="!readable" class="muted">No model that reads pictures is set up: bun run setup vision.</p>
  </div>
</template>
