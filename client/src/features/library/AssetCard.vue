<script setup lang="ts">
import type {LibraryEntry} from '../../../../shared/workspace'
import {LIBRARY_ROOTS} from '../../api/urls'
import MediaThumb from '../../components/MediaThumb.vue'
import {plural} from '../../lib/format'
import {assetKindLabel} from './labels'

defineProps<{asset: LibraryEntry, selected: boolean}>()
defineEmits<{select: []}>()
</script>

<template>
  <button :class="['card', {selected}]" :aria-pressed="selected" @click="$emit('select')">
    <MediaThumb :media="asset.picture" :roots="LIBRARY_ROOTS" :width="640" />
    <span class="body">
      <span class="name">{{ asset.name }}</span>
      <span class="muted">{{ asset.id }}</span>
      <span class="row">
        <span class="chip">{{ assetKindLabel(asset.kind) }}</span>
        <span v-if="asset.usedBy.length" class="chip good">In {{ plural(asset.usedBy.length, 'project') }}</span>
        <span v-else class="chip">Not used yet</span>
      </span>
    </span>
  </button>
</template>
