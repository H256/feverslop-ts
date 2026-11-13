<script setup lang="ts">
import SplitLayout from '../../components/SplitLayout.vue'
import {computed} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import type {EditorFreshness, EditorReference} from '../../../../shared/workspace'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import ReferenceCard from './ReferenceCard.vue'
import ReferenceDetail from './ReferenceDetail.vue'

/** The pictures every clip is made from: the characters, places and props of the plan, each with its sheet and versions. */
const {api, project} = useProject()
const route = useRoute(),
  router = useRouter()
const {data, loading, error, reload, refresh} = usePageData(
  async signal => {
    const [{references}, fresh] = await Promise.all([api.references(signal), api.freshness(signal).catch((): EditorFreshness => ({clips: {}, pictures: {}}))])
    return {references, fresh}
  },
  {live: true},
)
const GROUPS = [
  ['character', 'Characters'],
  ['location', 'Places'],
  ['prop', 'Props'],
] as const
const references = computed(() => data.value?.references ?? [])
const groups = computed(() =>
  GROUPS.map(([kind, title]) => ({kind, title, references: references.value.filter(r => r.kind === kind)})).filter(g => g.references.length),
)
// the picked one is in the address: a link from elsewhere opens it
const selected = computed(() => references.value.find(r => r.id === route.hash.slice(1)) ?? references.value[0])
const select = (reference: EditorReference) => {
  void router.replace({hash: `#${reference.id}`})
}
</script>

<template>
  <SplitLayout full label="Reference">
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <template v-if="data">
      <div v-if="!references.length" class="empty">No pictures planned yet - run {{ project.command }}</div>
      <div v-for="group in groups" :key="group.kind" class="section">
        <PageBar :title="group.title" />
        <div class="cards">
          <ReferenceCard
            v-for="reference in group.references"
            :key="reference.id"
            :reference="reference"
            :fresh="data.fresh.pictures[reference.id]"
            :selected="reference === selected"
            @select="select(reference)"
          />
        </div>
      </div>
    </template>
    <template #side>
      <ReferenceDetail v-if="selected && data" :key="selected.id" :reference="selected" :fresh="data.fresh.pictures[selected.id]" @changed="refresh" />
      <div v-else class="empty">Nothing here yet.</div>
    </template>
  </SplitLayout>
</template>
