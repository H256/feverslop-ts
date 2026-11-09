<script setup lang="ts">
import {computed} from 'vue'
import type {CastingRole} from '../../../../shared/workspace'
import MediaThumb from '../../components/MediaThumb.vue'
import NoticeList from '../../components/NoticeList.vue'
import {plural} from '../../lib/format'
import {useViewer} from '../../services/viewer'
import {useProject} from '../project/session'

/**
 * A role and who plays it, as a card: rendered in this project, or an asset of the library. A choice is asked for by the page. Where
 * the cast can shrink the role can be taken out - marked here (`out`), and saved by the page with whatever else is taken out.
 */
const props = defineProps<{role: CastingRole; options: string[]; removable: boolean; out?: boolean}>()
const emit = defineEmits<{choose: [value: string, select: HTMLSelectElement]; remove: []; putBack: []}>()
const {roots, project} = useProject()
const viewer = useViewer()
const own = computed(() => `project:${props.role.id}`)
const value = computed(() => props.role.entry ?? own.value)
// an entry the library does not have (any more) is still shown as what casting.json says
const unknown = computed(() => props.role.entry && props.role.entry !== own.value && !props.options.some(id => `library:${id}` === props.role.entry))
const about = computed(() => (props.role.kind === 'character' ? props.role.role || 'Character' : 'Place'))
</script>

<template>
  <article :class="['role', {out}]">
    <MediaThumb
      :media="role.picture"
      :roots="roots"
      cls=""
      :style="role.picture ? {cursor: 'zoom-in'} : undefined"
      @click="role.picture && viewer.open(role.picture, roots, role.name, role.id)"
    />
    <div class="player">
      <div>
        <b>{{ role.name }}</b> <span class="muted">{{ role.id }}</span>
      </div>
      <div class="muted about" :title="about">{{ about }}</div>
      <div class="muted">{{ plural(role.clips.length, 'clip') }}</div>
      <div v-if="out" class="warn">{{ project.kind === 'film' ? 'Out of the screenplay told anew.' : 'Out of the cast when saved.' }}</div>
      <div v-else-if="role.libraryId && !role.copied" class="warn">Not copied yet: the next run takes it from the library.</div>
      <NoticeList v-if="!out" :errors="role.errors" :warnings="role.warnings" />
    </div>
    <div class="choice">
      <template v-if="out">
        <button class="btn" :aria-label="`Put back ${role.name}`" :title="`Keep ${role.name} in the cast`" @click="emit('putBack')">Put back</button>
      </template>
      <template v-else>
        <select
          :aria-label="`Who plays ${role.name}`"
          :value="value"
          @change="emit('choose', ($event.target as HTMLSelectElement).value, $event.target as HTMLSelectElement)"
        >
          <option :value="own">Rendered in this project</option>
          <option v-for="id in options" :key="id" :value="`library:${id}`">library: {{ id }}</option>
          <option v-if="unknown" :value="role.entry">{{ role.entry }}</option>
        </select>
        <button
          v-if="removable"
          class="btn"
          :aria-label="`Remove ${role.name}`"
          :title="
            project.kind === 'film'
              ? 'Out of the film: the screenplay is told anew without them, as a proposal. Asked for with the bar below'
              : role.kind === 'character'
                ? 'Out of the cast: the beats and shots are planned without them. Saved with the bar below'
                : 'Out of the cast: the beats are planned without it. Saved with the bar below'
          "
          @click="emit('remove')"
        >
          Remove
        </button>
      </template>
    </div>
  </article>
</template>
