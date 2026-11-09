<script setup lang="ts">
import {ref} from 'vue'
import {mediaUrl} from '../../api/urls'
import ModalDialog from '../../components/ModalDialog.vue'
import {dateOf} from '../../lib/format'
import {useTimeline} from './context'
import type {Compared} from './useTimeline'

/** Two versions of a clip side by side, played together from the start - the one there is, and another. */
const props = defineProps<{compared: Compared}>()
const emit = defineEmits<{close: []}>()
const {session, actions} = useTimeline()
const modal = ref<InstanceType<typeof ModalDialog>>()
const a = ref<HTMLVideoElement>()
const b = ref<HTMLVideoElement>()
const together = async () => {
  if (!a.value || !b.value) return
  b.value.currentTime = a.value.currentTime = 0
  await Promise.all([a.value.play(), b.value.play()]).catch(() => {})
}
const close = () => modal.value?.close()
const pick = () => {
  const {clip, version} = props.compared
  close()
  if (version.id) actions.pickVersion(clip, {...version, id: version.id})
}
const right = () =>
  props.compared.refined ?? `${dateOf(props.compared.version.made)}${props.compared.version.seed !== undefined ? ` · seed ${props.compared.version.seed}` : ''}`
</script>

<template>
  <ModalDialog ref="modal" class="compare" label="Compare versions" @close="emit('close')">
    <div class="pair">
      <div>
        <p class="muted">{{ compared.refined ? 'The original' : compared.fresh ? 'Just rendered' : 'Now' }}</p>
        <video ref="a" :src="compared.clip.video && mediaUrl(compared.clip.video, session.roots)" controls preload="auto" playsinline />
      </div>
      <div>
        <p class="muted">{{ right() }}</p>
        <video ref="b" :src="mediaUrl({file: compared.version.video}, session.roots)" controls preload="auto" muted playsinline />
      </div>
    </div>
    <div class="btn-row">
      <button class="btn primary" @click="together">Play both from the start</button>
      <div class="spacer" />
      <button v-if="!compared.refined" class="btn" @click="pick">{{ compared.fresh ? 'Go back to the old one' : 'Make the right one current' }}</button>
      <button :class="compared.fresh ? 'btn primary' : 'btn'" @click="close">{{ compared.fresh ? 'Keep the new one' : 'Close' }}</button>
    </div>
  </ModalDialog>
</template>
