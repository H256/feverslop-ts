<script setup lang="ts">
import {computed} from 'vue'
import type {CastingRole} from '../../../../shared/workspace'
import MediaThumb from '../../components/MediaThumb.vue'
import NoticeList from '../../components/NoticeList.vue'
import {plural} from '../../lib/format'
import {useViewer} from '../../services/viewer'
import {useProject} from '../project/session'

/** A role and who plays it: rendered in this project, or an asset of the library. A choice is asked for by the page. */
const props = defineProps<{role: CastingRole, options: string[]}>()
const emit = defineEmits<{choose: [value: string, select: HTMLSelectElement]}>()
const {roots} = useProject()
const viewer = useViewer()
const own = computed(() => `project:${props.role.id}`)
const value = computed(() => props.role.entry ?? own.value)
// an entry the library does not have (any more) is still shown as what casting.json says
const unknown = computed(() => props.role.entry && props.role.entry !== own.value && !props.options.some(id => `library:${id}` === props.role.entry))
</script>

<template>
  <article class="role">
    <MediaThumb :media="role.picture" :roots="roots" cls="" :style="role.picture ? {cursor: 'zoom-in'} : undefined" @click="role.picture && viewer.open(role.picture, roots, role.name, role.id)" />
    <div>
      <b>{{ role.name }}</b> <span class="muted">{{ role.id }}</span>
      <div class="muted">{{ [role.kind === 'character' ? (role.role || 'Character') : 'Place', plural(role.clips.length, 'clip')].join(' · ') }}</div>
      <div v-if="role.libraryId && !role.copied" class="warn">Not copied yet: the next run takes it from the library.</div>
      <NoticeList :errors="role.errors" :warnings="role.warnings" />
    </div>
    <select :aria-label="`Who plays ${role.name}`" :value="value" @change="emit('choose', ($event.target as HTMLSelectElement).value, $event.target as HTMLSelectElement)">
      <option :value="own">Rendered in this project</option>
      <option v-for="id in options" :key="id" :value="`library:${id}`">library: {{ id }}</option>
      <option v-if="unknown" :value="role.entry">{{ role.entry }}</option>
    </select>
  </article>
</template>
