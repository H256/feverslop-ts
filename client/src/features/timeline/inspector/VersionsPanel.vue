<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import type {ClipVersionView, EditorClip} from '../../../../../shared/workspace'
import VersionCard from '../../../components/VersionCard.vue'
import {joined} from '../../../lib/format'
import {useToasts} from '../../../services/toasts'
import {useViewer} from '../../../services/viewer'
import {useTimeline} from '../context'

/** What was put away of the clip: compared with the one there is, or made current again. */
const props = defineProps<{clip: EditorClip}>()
const {loadVersions, versions, actions, compare: compareWith, session} = useTimeline()
const {fail} = useToasts()
const viewer = useViewer()
// only the versions of this clip are shown; asked for again whenever they are not there - another clip, a new snapshot of the project
const list = computed(() => versions.value?.clip === props.clip.id ? versions.value.list : undefined)
const failed = ref(false)
watch(() => [props.clip, list.value === undefined] as const, ([clip, missing]) => {
  failed.value = false
  if (missing) loadVersions(clip).catch(cause => { failed.value = true; fail(cause) })
}, {immediate: true})
const SOURCES: Record<ClipVersionView['source'], string> = {again: 'rendered again', stale: 'from an older plan', leak: 'had a grey backdrop', size: 'came out at the wrong size'}
const about = (version: ClipVersionView) => joined([SOURCES[version.source], version.seed !== undefined && `seed ${version.seed}`, version.size])
const compare = (version: ClipVersionView) => compareWith({clip: props.clip, version})
const frameOf = (version: ClipVersionView) => version.firstFrame ? {file: version.firstFrame} : undefined
</script>

<template>
  <div v-if="failed" class="empty">The versions could not be read.</div>
  <div v-else-if="!list" class="empty">Looking…</div>
  <div v-else-if="!list.length" class="empty">No older versions. What is rendered again is kept here.</div>
  <div v-else class="section">
    <VersionCard v-for="version in list" :key="version.id" :picture="frameOf(version)" :roots="session.roots" :made="version.made" :about="about(version)" @view="viewer.open(frameOf(version)!, session.roots, 'Older version', clip.id)">
      <template #note><div v-if="version.fromThisPlan === false" class="muted" style="color: var(--stale)">Made from another plan: it will count as stale.</div></template>
      <button v-if="clip.video" class="btn" @click="compare(version)">Compare</button>
      <button class="btn" @click="actions.pickVersion(clip, version)">Make current</button>
    </VersionCard>
  </div>
</template>
