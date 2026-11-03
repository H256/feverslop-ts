<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink} from 'vue-router'
import {mediaUrl} from '../../api/urls'
import {useTimeline} from './context'

/** What the project is as a whole, in the top bar: the final video, the last run, pictures missing or stale, the next step. */
const {project, fresh, status, session, actions} = useTimeline()
const FINAL = {missing: ['No final video', 'chip'], current: ['Final video current', 'chip good'], older: ['Final video older than its clips', 'chip stale']} as const
const RUN = {running: ['Running', 'chip good'], failed: ['Last run failed', 'chip bad'], stopped: ['Last run stopped', 'chip bad']} as const
const final = computed(() => FINAL[project.value.final.state])
const last = computed(() => project.value.lastRun)
const run = computed(() => last.value && last.value.state !== 'finished' ? RUN[last.value.state] : undefined)
const failed = computed(() => last.value?.state === 'failed' || last.value?.state === 'stopped')
const missingPictures = computed(() => project.value.pictures.filter(p => !p.exists).length)
const stalePictures = computed(() => project.value.pictures.filter(p => fresh.value.pictures[p.id] === 'stale').length)
const next = computed(() => status.value?.next)
</script>

<template>
  <span class="chip">{{ project.kind === 'film' ? 'Film' : 'Music video' }}</span>
  <span :class="final[1]"><a v-if="project.final.file" :href="mediaUrl({file: project.final.file, v: project.final.v}, session.roots)" target="_blank" rel="noopener">{{ final[0] }}</a><template v-else>{{ final[0] }}</template></span>
  <a v-if="project.previewVideo" class="chip" :href="mediaUrl(project.previewVideo, session.roots)" target="_blank" rel="noopener">Preview video</a>
  <span v-if="run && last" :class="run[1]" :title="[last.command, ...last.failures].join('\n')">{{ run[0] }}</span>
  <button v-if="failed && last" class="chip" :title="last.command" @click="actions.repeatLast(last)">Repeat</button>
  <RouterLink v-if="missingPictures" class="chip bad" :to="`${session.root}/references`">{{ missingPictures }} pictures missing</RouterLink>
  <RouterLink v-if="stalePictures" class="chip stale" :to="`${session.root}/references`">{{ stalePictures }} pictures stale</RouterLink>
  <button v-if="next?.command" class="chip next" :title="[next.why, next.command, next.estimate].filter(Boolean).join('\n')" @click="actions.runNext(next)">Next: {{ next.why }}</button>
</template>
