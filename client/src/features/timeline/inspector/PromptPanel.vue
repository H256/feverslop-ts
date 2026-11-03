<script setup lang="ts">
import {computed} from 'vue'
import type {EditorClip, EditorPicture} from '../../../../../shared/workspace'
import {useTimeline} from '../context'

/** The prompt of the clip. <Picture N> and <Audio N> are its own markup: they point at the references of the clip. */
const props = defineProps<{clip: EditorClip}>()
const {peek} = useTimeline()
const TOKEN = /^<(Picture|Audio) \d+>$/
const parts = computed(() => props.clip.prompt.split(/(<(?:Picture|Audio) \d+>)/g).map(text => {
  if (!TOKEN.test(text)) return {text}
  const label = text.slice(1, -1)
  const named = (item: {label: string}) => item.label === text || item.label === label
  const ref = props.clip.pictures.find(named) ?? props.clip.audio.find(named)
  const picture = props.clip.pictures.find(p => named(p) && p.exists)
  return {text, token: true, picture, title: picture ? '' : ref ? ('name' in ref ? ref.name : ref.stem) ?? '' : ''}
}))
const show = (event: PointerEvent, picture: EditorPicture) => {
  peek.value = {picture, at: 0, x: event.clientX, top: (event.target as HTMLElement).getBoundingClientRect().top}
}
const hide = () => { peek.value = undefined }
</script>

<template>
  <div class="prompt"><template v-for="(part, n) in parts" :key="n"><span v-if="part.token" class="token" :title="part.title" @pointerenter="part.picture && show($event, part.picture)" @pointerleave="part.picture && hide()">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></div>
</template>
