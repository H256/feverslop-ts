<script setup lang="ts">
import type {EditorReference, Freshness} from '../../../../shared/workspace'
import MediaThumb from '../../components/MediaThumb.vue'
import {plural} from '../../lib/format'
import {TERMS} from '../../lib/terms'
import {useProject} from '../project/session'

defineProps<{reference: EditorReference; fresh?: Freshness; selected: boolean}>()
defineEmits<{select: []}>()
const {roots} = useProject()
</script>

<template>
  <button :class="['card', {selected}]" :aria-pressed="selected" @click="$emit('select')">
    <MediaThumb :media="reference.picture" :roots="roots" :width="640" />
    <span class="body">
      <span class="name">{{ reference.name }}</span>
      <span class="muted">{{ plural(reference.clips.length, 'clip') }} use this</span>
      <span class="row">
        <span v-if="!reference.picture" class="chip bad">Missing</span>
        <span v-else-if="fresh === 'stale'" class="chip stale" :title="TERMS.Stale">Stale</span>
        <span v-else-if="fresh === 'pinned'" class="chip" :title="TERMS.Pinned">Pinned</span>
        <span v-if="reference.library" class="chip">library:{{ reference.library }}</span>
        <span v-if="reference.look" class="chip">Another look</span>
        <span v-if="reference.versions.length" class="chip">{{ plural(reference.versions.length, 'older version') }}</span>
      </span>
    </span>
  </button>
</template>
