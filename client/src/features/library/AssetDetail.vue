<script setup lang="ts">
import type {LibraryEntry} from '../../../../shared/workspace'
import {mediaUrl, projectRoot} from '../../api/workspace'
import {assetKindLabel} from './labels'
defineProps<{asset: LibraryEntry}>()
</script>

<template>
  <aside class="asset-detail" aria-label="Asset details">
    <a v-if="asset.picture" :href="mediaUrl(asset.picture, '/library/media')" target="_blank" rel="noopener" aria-label="Open full picture"><img class="detail-picture" :src="mediaUrl(asset.picture, '/library/thumb', 640)" :alt="asset.name"></a>
    <h2>{{ asset.name }}</h2><p class="muted">{{ assetKindLabel(asset.kind) }} · {{ asset.id }}</p>
    <h3>Description</h3><p class="prose">{{ asset.description }}</p>
    <template v-if="asset.anchors"><h3>Background features</h3><p class="prose">{{ asset.anchors }}</p></template>
    <template v-if="asset.video"><h3>Sequence</h3><video :key="asset.video.file" :src="mediaUrl(asset.video, '/library/media')" controls preload="metadata" /></template>
    <template v-if="asset.frames.length"><h3>Views</h3><div class="strip"><a v-for="(frame, n) in asset.frames" :key="frame.file" :href="mediaUrl(frame, '/library/media')" target="_blank" rel="noopener"><img :src="mediaUrl(frame, '/library/thumb', 320)" :alt="`View ${n + 1}`" loading="lazy"></a></div></template>
    <h3>Used by</h3>
    <ul v-if="asset.usedBy.length"><li v-for="use in asset.usedBy" :key="`${use.kind}/${use.id}/${use.role}`"><a :href="`${projectRoot(use)}/casting`">{{ use.id }}</a> as {{ use.role }}</li></ul>
    <p v-else>No project plays this one yet. Choose it on the Casting page of a project.</p>
    <dl><template v-if="asset.source"><dt>Comes from</dt><dd>{{ asset.source }}</dd></template><template v-if="asset.created"><dt>Made</dt><dd>{{ asset.created }}</dd></template></dl>
  </aside>
</template>
