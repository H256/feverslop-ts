<script setup lang="ts">
import {computed, h, reactive, ref} from 'vue'
import type {AssetKind, LibraryEntry, LibrarySongEntry} from '../../../../shared/workspace'
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
import SongDetail from './SongDetail.vue'

usePageTitle('Asset library', 'Library · Workspace')
const {data, loading, error, reload} = useResource(signal => workspace.library(signal))
const run = useRunDock()
const ask = useAsk()
const servers = useServers()
const toasts = useToasts()
run.follow({events: workspace.libraryEvents, said: {done: 'The asset is in the library', failed: 'Making the asset failed - see the log'}})
run.onEnd(() => { void reload() })

const KINDS = [{value: 'all', label: 'All'}, {value: 'character', label: 'Characters'}, {value: 'location', label: 'Places'}, {value: 'song', label: 'Songs'}] as const
const text = ref('')
const kind = ref<'all' | AssetKind | 'song'>('all')
const selectedKey = ref('')
const keyOf = (asset: LibraryEntry) => `${asset.kind}/${asset.id}`
const assets = computed(() => data.value?.assets ?? [])
const shown = computed(() => assets.value.filter(asset => (kind.value === 'all' || asset.kind === kind.value) && matchesText(text.value, asset.id, asset.name)))
// the songs of the library (#835): a tab of their own - they have no picture
const songs = computed(() => (data.value?.songs ?? []).filter(song => matchesText(text.value, song.id, song.name)))
const songKey = (song: LibrarySongEntry) => `song/${song.id}`
const selectedSong = computed(() => songs.value.find(song => songKey(song) === selectedKey.value))
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
    submit: async () => {
      // asked for in the library: a late answer starts nothing in a project opened meanwhile
      const started = run.starter()
      started((await workspace.createAsset(assetForm(asset, servers.take()))).run)
    },
  })
})
</script>

<template>
  <div class="split view">
    <div class="scrollpage">
      <PageBar title="Library">
        <SegmentedControl v-model="kind" :options="KINDS" label="Asset kind" />
        <input v-model="text" type="search" :placeholder="kind === 'song' ? 'Find a song' : 'Find an asset'" :aria-label="kind === 'song' ? 'Find a song' : 'Find an asset'">
        <span v-if="data" class="muted" :title="data.dir">{{ kind === 'song' ? plural(songs.length, 'song') : plural(shown.length, 'asset') }}</span>
        <div class="spacer" />
        <button class="btn primary" @click="createAsset">New asset from a picture</button>
      </PageBar>
      <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
      <div v-if="data && kind === 'song'" class="lp-songs">
        <button
          v-for="song in songs"
          :key="song.id"
          :class="['lp-song', {selected: selectedSong === song}]"
          :aria-pressed="selectedSong === song"
          @click="selectedKey = songKey(song)"
        >
          <span class="name">{{ song.name }}</span>
          <span class="muted">{{ song.id }}</span>
          <span class="chip">{{ song.usedBy.length ? `In ${plural(song.usedBy.length, 'project')}` : 'Not used yet' }}</span>
        </button>
        <div v-if="!songs.length" class="empty">No songs in the library. Put one in from a project: bun run export-song &lt;project-id&gt;</div>
      </div>
      <div v-else-if="data" class="cards">
        <AssetCard v-for="asset in shown" :key="keyOf(asset)" :asset="asset" :selected="selected === asset" @select="selectedKey = keyOf(asset)" />
        <div v-if="!shown.length" class="empty">{{ assets.length ? 'Nothing fits.' : 'The library is empty. Put an asset in from the References page of a project, or make one from a picture.' }}</div>
      </div>
    </div>
    <aside class="detail" aria-label="Asset details">
      <SongDetail v-if="kind === 'song' && selectedSong" :key="songKey(selectedSong)" :song="selectedSong" @changed="reload" />
      <AssetDetail v-else-if="kind !== 'song' && selected" :key="keyOf(selected)" :asset="selected" @changed="reload" />
      <div v-else class="empty">{{ kind === 'song' ? 'Pick a song.' : 'Pick an asset.' }}</div>
    </aside>
  </div>
</template>

<style scoped>
/* the songs as a list: names, no pictures. Prefixed (lp-): .song and .card are styled for other pages in workspace.css */
.lp-songs {
  display: grid;
  gap: var(--space-1, 4px);
}
.lp-song {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3, 12px);
  padding: 8px 12px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-m, 8px);
}
.lp-song.selected {
  box-shadow: inset 0 0 0 2px var(--accent);
}
</style>

