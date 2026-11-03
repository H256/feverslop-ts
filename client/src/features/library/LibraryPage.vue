<script setup lang="ts">
import {computed, h, reactive, ref} from 'vue'
import type {AssetKind, LibraryEntry} from '../../../../shared/workspace'
import {workspace} from '../../api/workspace'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import {useResource} from '../../composables/useResource'
import {plural} from '../../lib/format'
import {matchesText} from '../../lib/search'
import {useAsk} from '../../services/ask'
import {usePageTitle} from '../../services/chrome'
import {useRunDock} from '../../services/run'
import {useServers} from '../../services/servers'
import {useToasts} from '../../services/toasts'
import AssetCard from './AssetCard.vue'
import AssetDetail from './AssetDetail.vue'
import {assetForm, newAsset} from './forms'
import NewAssetForm from './NewAssetForm.vue'

usePageTitle('Asset library', 'Library · Workspace')
const {data, loading, error, reload} = useResource(signal => workspace.library(signal))
const run = useRunDock()
const ask = useAsk()
const servers = useServers()
const toasts = useToasts()
run.follow({events: workspace.libraryEvents, said: {done: 'The asset is in the library', failed: 'Making the asset failed - see the log'}})
run.onEnd(() => { void reload() })

const KINDS = [{value: 'all', label: 'All'}, {value: 'character', label: 'Characters'}, {value: 'location', label: 'Places'}] as const
const text = ref('')
const kind = ref<'all' | AssetKind>('all')
const selectedKey = ref('')
const keyOf = (asset: LibraryEntry) => `${asset.kind}/${asset.id}`
const assets = computed(() => data.value?.assets ?? [])
const shown = computed(() => assets.value.filter(asset => (kind.value === 'all' || asset.kind === kind.value) && matchesText(text.value, asset.id, asset.name)))
// the picked one stays picked while it is there - in the list as it is now
const selected = computed(() => assets.value.find(asset => keyOf(asset) === selectedKey.value))

/** A new asset from a picture: the picture becomes the anchor, ComfyUI renders the sheet from it. */
const createAsset = toasts.guard(async () => {
  const asset = reactive(newAsset())
  // sent from the open question: a refusal (an id the library has) is said there, with the form still filled in
  await ask({
    title: 'New asset from a picture',
    lines: ['The picture becomes the anchor, ComfyUI renders the reference sheet from it. An asset already in the library is never overwritten.'],
    body: () => h(NewAssetForm, {draft: asset}),
    confirm: 'Render it',
    render: true,
    submit: async () => { run.started((await workspace.createAsset(assetForm(asset, servers.take()))).run) },
  })
})
</script>

<template>
  <div class="split view">
    <div class="scrollpage">
      <PageBar title="Library">
        <SegmentedControl v-model="kind" :options="KINDS" label="Asset kind" />
        <input v-model="text" type="search" placeholder="Find an asset" aria-label="Find an asset">
        <span v-if="data" class="muted" :title="data.dir">{{ plural(shown.length, 'asset') }}</span>
        <div class="spacer" />
        <button class="btn primary" @click="createAsset">New asset from a picture</button>
      </PageBar>
      <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
      <div v-if="data" class="cards">
        <AssetCard v-for="asset in shown" :key="keyOf(asset)" :asset="asset" :selected="selected === asset" @select="selectedKey = keyOf(asset)" />
        <div v-if="!shown.length" class="empty">{{ assets.length ? 'Nothing fits.' : 'The library is empty. Put an asset in from the References page of a project, or make one from a picture.' }}</div>
      </div>
    </div>
    <aside class="detail" aria-label="Asset details">
      <AssetDetail v-if="selected" :key="keyOf(selected)" :asset="selected" />
      <div v-else class="empty">Pick an asset.</div>
    </aside>
  </div>
</template>
