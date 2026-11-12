<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink} from 'vue-router'
import type {ListingStatus, ProjectListing} from '../../../../shared/workspace'
import {projectRoot, rootsOf} from '../../api/urls'
import MediaThumb from '../../components/MediaThumb.vue'
import {dateOf, plural} from '../../lib/format'
import {stageName} from '../plan/stages'

const props = defineProps<{project: ProjectListing, status?: ListingStatus, more: number}>()
defineEmits<{expand: []}>()
const FINAL = {missing: ['No final video', 'chip'], current: ['Final video', 'chip good'], older: ['Final older than its clips', 'chip stale'], variant: ['Final video: made over', 'chip good']} as const
const RUN = {running: ['Running', 'chip good'], failed: ['Last run failed', 'chip bad'], stopped: ['Last run stopped', 'chip bad']} as const
const root = computed(() => projectRoot(props.project))
const run = computed(() => {
  const state = props.project.lastRun?.state
  return state && state !== 'finished' ? RUN[state] : undefined
})
const rendered = computed(() => props.project.clips ? props.project.rendered / props.project.clips * 100 : 0)
</script>

<template>
  <div class="card">
    <RouterLink class="card-link" :to="`${root}/`">
      <MediaThumb :media="project.thumb" :roots="rootsOf(root)" :width="640" />
      <span class="body">
        <span class="name" :title="project.id">{{ project.title }}</span>
        <span class="muted num"
          >{{ project.rendered }} of {{ plural(project.clips, 'clip') }} rendered<template v-if="project.changed"> · changed {{ dateOf(project.changed) }}</template></span
        >
        <span class="bar"><i :style="{width: `${rendered}%`}" /></span>
        <span class="row">
          <span class="chip">{{ project.kind === 'film' ? 'Film' : 'Music video' }}</span>
          <span :class="FINAL[project.final][1]">{{ FINAL[project.final][0] }}</span>
          <span v-if="run" :class="run[1]" :title="project.lastRun?.command">{{ run[0] }}</span>
          <span v-if="project.stage" class="chip" title="Planned up to this stage, nothing rendered yet">Planned: {{ stageName(project.stage, project.kind).toLowerCase() }}</span>
        </span>
        <span class="row">
          <span v-if="status?.clips.stale" class="chip stale">{{ status.clips.stale }} clips stale</span>
          <span v-if="status?.pictures.stale" class="chip stale">{{ status.pictures.stale }} pictures stale</span>
        </span>
        <span class="next" :title="status ? [status.next.command, status.next.estimate].filter(Boolean).join('\n') : undefined">{{ status ? (status.next.command ? `Next: ${status.next.why}` : 'Everything is done') : ' ' }}</span>
      </span>
    </RouterLink>
    <RouterLink
      v-if="project.newest && project.newest !== `${project.id}.mp4`"
      class="pc-newest"
      :to="{path: `${root}/postwork`, query: {play: project.newest}}"
      title="The newest finished video - it plays on the Post-work page when you play it"
      >{{ project.newest }}</RouterLink
    >
    <button v-if="more" class="more" aria-expanded="false" @click="$emit('expand')">{{ plural(more, 'more take') }}</button>
  </div>
</template>

<style scoped>
/* the newest finished video, under the card: played on the Post-work page on a click (#832) */
.pc-newest {
  display: block;
  padding: 0 var(--space-3) var(--space-2);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
