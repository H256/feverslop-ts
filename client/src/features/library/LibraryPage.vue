<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {workspace, mediaUrl} from '../../api/workspace'
import {useResource} from '../../composables/useResource'
import {useDocumentTitle} from '../../composables/useDocumentTitle'
import {matchesText} from '../../search'
import ResourceState from '../../components/ResourceState.vue'
import AssetDetail from './AssetDetail.vue'
import {assetKindLabel} from './labels'
import type {LibraryEntry} from '../../../../shared/workspace'

const {data, loading, error, reload} = useResource(workspace.library)
const text = ref(''), kind = ref('all'), selectedKey = ref('')
const keyOf = (asset: LibraryEntry) => `${asset.kind}/${asset.id}`
const shown = computed(() => (data.value?.assets ?? []).filter(asset => (kind.value === 'all' || asset.kind === kind.value) && matchesText(text.value, asset.id, asset.name)))
const selected = computed(() => shown.value.find(asset => keyOf(asset) === selectedKey.value))
watch(shown, () => { if (!selected.value) selectedKey.value = '' })
useDocumentTitle('Library')
</script>

<template>
  <section aria-labelledby="library-title">
    <div class="pagebar"><h1 id="library-title">Library</h1><button :disabled="loading" @click="reload">Refresh</button></div>
    <div class="filters"><label>Find an asset<input v-model="text" type="search"></label><label>Asset kind<select v-model="kind"><option value="all">All</option><option value="character">Characters</option><option value="location">Places</option></select></label></div>
    <p class="notice"><a href="/library?legacy=1">New asset from a picture</a> — opens the existing creation tools and run log.</p>
    <ResourceState :loading="loading" :error="error" @retry="reload" />
    <template v-if="data && !loading && !error">
      <p class="muted" :title="data.dir" role="status">{{ shown.length }} assets</p>
      <div class="library-layout"><div>
        <div class="cards"><button v-for="asset in shown" :key="keyOf(asset)" class="card asset-card" :aria-pressed="selectedKey === keyOf(asset)" @click="selectedKey = keyOf(asset)">
          <img v-if="asset.picture" class="thumb" :src="mediaUrl(asset.picture, '/library/thumb', 640)" alt="" loading="lazy"><span v-else class="thumb placeholder" aria-hidden="true">{{ assetKindLabel(asset.kind) }}</span>
          <span class="card-body"><strong>{{ asset.name }}</strong><span class="muted">{{ asset.id }}</span><span>{{ assetKindLabel(asset.kind) }}</span><span>{{ asset.usedBy.length ? `In ${asset.usedBy.length} projects` : 'Not used yet' }}</span></span>
        </button></div>
        <p v-if="!shown.length" class="empty">{{ data.assets.length ? 'Nothing fits.' : 'The library is empty. Add an asset from the References page of a project in the existing workspace.' }}</p>
      </div><AssetDetail v-if="selected" :key="keyOf(selected)" :asset="selected" /><p v-else class="empty">Pick an asset.</p></div>
    </template>
  </section>
</template>
