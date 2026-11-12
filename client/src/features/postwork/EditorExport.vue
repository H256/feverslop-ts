<script setup lang="ts">
import {computed, onMounted, shallowRef} from 'vue'
import type {ProjectStatus} from '../../../../shared/workspace'
import {plural} from '../../lib/format'
import {useProject} from '../project/session'

/**
 * The timeline for a video editor (#836): a music video's `bun index.ts <id> --export=mlt,openshot` - the rendered clips on one track,
 * the song under them - and the EDL a film writes when it is assembled. The export is a plan run that reuses every step: it is only
 * offered when it has nothing to make first and every clip is rendered, so a click never plans or renders.
 */
const {project, api, start, busy} = useProject()
const status = shallowRef<ProjectStatus>()
onMounted(async () => {
  status.value = await api.status().catch(() => undefined)
})

const FORMATS = [
  {format: 'mlt', name: 'Shotcut / Kdenlive'},
  {format: 'openshot', name: 'OpenShot'},
] as const
const edits = computed(() => project.value.postwork.edits)
const fileOf = (format: string) => edits.value.find(e => e.format === format)
const when = (changed: number) => new Date(changed).toLocaleString()

// what keeps the export from running as it is: steps a plan run would make first, clips not rendered
const blocked = computed(() => {
  const todo = status.value?.steps.filter(s => s.state === 'redo' || s.state === 'missing').length ?? 0
  if (todo) return `A plan run would make ${plural(todo, 'step')} first - plan on the Timeline, then export.`
  const missing = project.value.clips.filter(c => !c.video).length
  if (!project.value.clips.length) return 'No clips are planned yet.'
  if (missing) return `${plural(missing, 'clip')} not rendered yet - the timeline needs every clip.`
  return ''
})
const exportTo = (format: 'mlt' | 'openshot') => start({type: 'export', formats: [format]})
</script>

<template>
  <section class="ee" aria-label="For a video editor">
    <h3>For a video editor</h3>
    <template v-if="project.kind === 'music'">
      <p class="muted ee-line">The rendered clips on one track, the song under them - to cut further in an editor. Nothing is rendered.</p>
      <div v-for="item in FORMATS" :key="item.format" class="ee-row">
        <button class="btn" :disabled="busy || !status || !!blocked" @click="exportTo(item.format)">{{ item.name }}</button>
        <code v-if="fileOf(item.format)" :title="when(fileOf(item.format)!.changed)">{{ fileOf(item.format)!.file }}</code>
        <span v-else class="muted">not written yet</span>
      </div>
      <p v-if="blocked" class="muted ee-line">{{ blocked }}</p>
    </template>
    <template v-else>
      <p class="muted ee-line">
        A film writes its timeline as an EDL when it is assembled (Render the film on the Timeline): the clips used, cut as in the film.
      </p>
      <div class="ee-row">
        <code v-if="fileOf('edl')" :title="when(fileOf('edl')!.changed)">{{ fileOf('edl')!.file }}</code>
        <span v-else class="muted">not written yet</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ee {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
.ee h3 {
  margin: 0;
}
.ee-line {
  margin: 0;
}
.ee-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
</style>
