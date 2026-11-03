<script setup lang="ts">
import {ref} from 'vue'
import ModalDialog from '../../components/ModalDialog.vue'
import {TERMS} from '../../lib/terms'

/** The keys of the timeline and of a review, and the words of the pipeline. */
const emit = defineEmits<{close: []}>()
const modal = ref<InstanceType<typeof ModalDialog>>()
const KEYS = [
  ['Space', 'Play or pause'], ['K', 'Pause, normal speed'], ['J / L', 'Slower / faster'], [', / .', 'One frame back / forward'],
  ['← / →', 'Clip before / next clip'], ['Home / End', 'Start / end'], ['O', 'Loop the clip'], ['Shift+O', 'Loop the shot'],
  ['F', 'Full screen'], ['M', 'Sound on or off'], ['Ctrl+click', 'Mark a clip on the timeline'], ['Shift+click', 'Mark all up to this clip'], ['Ctrl+wheel', 'Zoom the timeline'], ['?', 'This page'],
]
const REVIEW = [['Enter', 'Fine, next clip'], ['R', 'Render again: mark it, next clip'], ['←', 'Clip before'], ['C', 'Compare with its older version'], ['Esc', 'End the review']]
</script>

<template>
  <ModalDialog ref="modal" class="help" label="Keys and words" @close="emit('close')">
    <h2>Keys and words</h2>
    <h3>Keys</h3>
    <dl><template v-for="[key, text] in KEYS" :key="key"><dt><kbd>{{ key }}</kbd></dt><dd>{{ text }}</dd></template></dl>
    <h3>In a review</h3>
    <dl><template v-for="[key, text] in REVIEW" :key="key"><dt><kbd>{{ key }}</kbd></dt><dd>{{ text }}</dd></template></dl>
    <h3>Words</h3>
    <dl><template v-for="(text, word) in TERMS" :key="word"><dt>{{ word }}</dt><dd>{{ text }}</dd></template></dl>
    <div class="btn-row" style="justify-content: flex-end; margin-top: 12px"><button class="btn" @click="modal?.close()">Close</button></div>
  </ModalDialog>
</template>
