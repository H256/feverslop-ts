<script setup lang="ts">
import {onMounted, ref} from 'vue'
import type {ClipVersionView, EditorClip} from '../../../../../shared/workspace'
import VersionCard from '../../../components/VersionCard.vue'
import {joined} from '../../../lib/format'
import {useToasts} from '../../../services/toasts'
import {useViewer} from '../../../services/viewer'
import {useTimeline} from '../context'

/** What was put away of the clip: compared with the one there is, or made current again. */
const props = defineProps<{clip: EditorClip}>()
const {loadVersions, versions, actions, compared, session} = useTimeline()
const {fail} = useToasts()
const viewer = useViewer()
const loading = ref(versions.value?.clip !== props.clip.id)
onMounted(() => { loadVersions(props.clip).catch(fail).finally(() => { loading.value = false }) })
const SOURCES = {again: 'rendered again', stale: 'from an older plan', leak: 'had a grey backdrop'} as const
const about = (version: ClipVersionView) => joined([SOURCES[version.source], version.seed !== undefined && `seed ${version.seed}`, version.size])
const compare = (version: ClipVersionView) => { compared.value = {clip: props.clip, version} }
const frameOf = (version: ClipVersionView) => version.firstFrame ? {file: version.firstFrame} : undefined
</script>

<template>
  <div v-if="loading" class="empty">Looking…</div>
  <div v-else-if="!versions?.list.length" class="empty">No older versions. What is rendered again is kept here.</div>
  <div v-else class="section">
    <VersionCard v-for="version in versions.list" :key="version.id" :picture="frameOf(version)" :roots="session.roots" :made="version.made" :about="about(version)" @view="viewer.open(frameOf(version)!, session.roots, 'Older version', clip.id)">
      <template #note><div v-if="version.fromThisPlan === false" class="muted" style="color: var(--stale)">Made from another plan: it will count as stale.</div></template>
      <button v-if="clip.video" class="btn" @click="compare(version)">Compare</button>
      <button class="btn" @click="actions.pickVersion(clip, version)">Make current</button>
    </VersionCard>
  </div>
</template>
