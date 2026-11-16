<script setup lang="ts">
import AppIcon from '../../components/AppIcon.vue'
import {ref} from 'vue'
import ModalDialog from '../../components/ModalDialog.vue'
import {TERMS} from '../../lib/terms'

/** The keys of the timeline and of a review, and the words of the pipeline. */
const emit = defineEmits<{close: []}>()
const modal = ref<InstanceType<typeof ModalDialog>>()
const KEYS = [
  ['Space', 'Play or pause'],
  ['K', 'Pause, normal speed'],
  ['J / L', 'Slower / faster'],
  [', / .', 'One frame back / forward'],
  ['← / →', 'Clip before / next clip'],
  ['Home / End', 'Start / end'],
  ['O', 'Loop the clip'],
  ['Shift+O', 'Loop the shot'],
  ['F', 'Full screen'],
  ['M', 'Sound on or off'],
  ['R', 'Render the clip at the playhead again - asked first'],
  ['Ctrl+click', 'Mark a clip on the timeline'],
  ['Shift+click', 'Mark all up to this clip'],
  ['Ctrl+wheel', 'Zoom the timeline'],
  ['?', 'This page'],
]
const REVIEW = [
  ['Space', 'Play or pause - the review plays its clips through, one after the other'],
  ['R', 'Render the playing clip again at the end - the playback goes on; again: taken back'],
  ['← / →', 'Clip before / next clip of the review'],
  ['O', 'Loop the clip, to see it again'],
  ['C', 'Compare with its older version'],
  ['Esc', 'End the review - the marked clips are offered for rendering, as at the end of the last one'],
]
</script>

<template>
  <ModalDialog ref="modal" class="help" label="Keys and words" @close="emit('close')">
    <h2>Keys and words</h2>
    <h3>Keys</h3>
    <dl>
      <template v-for="[key, text] in KEYS" :key="key"
        ><dt>
          <kbd>{{ key }}</kbd>
        </dt>
        <dd>{{ text }}</dd></template
      >
    </dl>
    <h3>In a review</h3>
    <dl>
      <template v-for="[key, text] in REVIEW" :key="key"
        ><dt>
          <kbd>{{ key }}</kbd>
        </dt>
        <dd>{{ text }}</dd></template
      >
    </dl>
    <h3>Words</h3>
    <dl>
      <template v-for="(text, word) in TERMS" :key="word"
        ><dt>{{ word }}</dt>
        <dd>{{ text }}</dd></template
      >
    </dl>
    <div class="btn-row u-end u-mt-3">
      <button class="btn" @click="modal?.close()"><AppIcon name="close" />Close</button>
    </div>
  </ModalDialog>
</template>
