<script setup lang="ts">
import {useToasts} from '../services/toasts'

/** The messages at the foot of the page (#940): the failures that are not closed yet, each with its words to copy, and the newest notice. */
const {notice, errors, dismiss, show} = useToasts()
const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => show('Copied'),
    () => show('Could not copy - select the words instead'),
  )
</script>

<template>
  <div v-if="errors.length || notice" class="toasts">
    <div v-for="error in errors" :key="error.id" class="toast bad" role="alert">
      <span class="toast-text">{{ error.text }}</span>
      <button type="button" class="toast-act" :aria-label="`Copy: ${error.text}`" title="Copy the words" @click="copy(error.text)">Copy</button>
      <button type="button" class="toast-act" :aria-label="`Close: ${error.text}`" title="Close" @click="dismiss(error.id)">✕</button>
    </div>
    <div v-if="notice" :key="notice.id" class="toast" role="status">{{ notice.text }}</div>
  </div>
</template>
