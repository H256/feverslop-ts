<script setup lang="ts">
import {RouterLink} from 'vue-router'
import type {LibraryEntry} from '../../../../shared/workspace'
import {LIBRARY_ROOTS, projectRoot} from '../../api/urls'
import FactList from '../../components/FactList.vue'
import SheetMedia from '../../components/SheetMedia.vue'
import {assetKindLabel} from './labels'
import LibraryActions from './LibraryActions.vue'

defineProps<{asset: LibraryEntry}>()
defineEmits<{changed: []}>()
</script>

<template>
  <div>
    <SheetMedia :item="asset" :roots="LIBRARY_ROOTS" :name="asset.name" :title="asset.name" :caption="asset.id" :text="asset.description">
      <h2>{{ asset.name }}</h2>
      <p class="muted section">{{ assetKindLabel(asset.kind) }} · {{ asset.id }}</p>
      <LibraryActions :id="asset.id" :kind="asset.kind" :name="asset.name" :description="asset.description" @changed="$emit('changed')" />
      <div class="section"><h3>Description</h3><p>{{ asset.description }}</p></div>
      <div v-if="asset.anchors" class="section"><h3>Background features</h3><p>{{ asset.anchors }}</p></div>
    </SheetMedia>
    <div class="section">
      <h3>Used by</h3>
      <div v-for="use in asset.usedBy" :key="`${use.kind}/${use.id}/${use.role}`"><RouterLink :to="`${projectRoot(use)}/casting`">{{ use.id }}</RouterLink><span class="muted"> as {{ use.role }}</span></div>
      <p v-if="!asset.usedBy.length" class="muted">No project plays this one yet. Choose it on the Casting page of a project.</p>
    </div>
    <FactList :facts="[{name: 'Comes from', value: asset.source}, {name: 'Made', value: asset.created}]" />
  </div>
</template>
