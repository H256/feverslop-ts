<script setup lang="ts">
import {computed, reactive, ref} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {projectRoot} from '../../api/urls'
import {workspace} from '../../api/workspace'
import PageBar from '../../components/PageBar.vue'
import PageNumbers from '../../components/PageNumbers.vue'
import ResourceState from '../../components/ResourceState.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import {useResource} from '../../composables/useResource'
import {plural} from '../../lib/format'
import {usePageTitle} from '../../services/chrome'
import ProjectCard from './ProjectCard.vue'
import {filterOf, groupProjects, KINDS, matchesFilter, PAGE_SIZE, queryOf, STATES, type ListFilter} from './listing'
import {useListingStatus} from './useListingStatus'

usePageTitle('All projects', 'Workspace')
const route = useRoute(), router = useRouter()
const {data, loading, error, reload} = useResource(signal => workspace.projects(signal))
const projects = computed(() => data.value?.projects ?? [])
const expanded = reactive(new Set<string>())
const filter = computed(() => filterOf(route.query))
const hits = computed(() => projects.value.filter(p => matchesFilter(p, filter.value)))
const entries = computed(() => groupProjects(hits.value, expanded, !!filter.value.text.trim()))
const pages = computed(() => Math.max(1, Math.ceil(entries.value.length / PAGE_SIZE)))
const page = computed(() => Math.min(pages.value, filter.value.page))
const first = computed(() => (page.value - 1) * PAGE_SIZE)
const shown = computed(() => entries.value.slice(first.value, first.value + PAGE_SIZE))
const count = computed(() => hits.value.length === entries.value.length ? plural(hits.value.length, 'project') : `${plural(entries.value.length, 'group')} · ${plural(hits.value.length, 'project')}`)
const {statusOf} = useListingStatus(computed(() => shown.value.map(entry => entry.project)))

const list = ref<HTMLElement>()
/** A change of the filter is a place in the history; typing is not. Another filter starts on the first page. */
function change(next: Partial<ListFilter>, replace = false) {
  const query = queryOf({...filter.value, page: 1, ...next})
  void router[replace ? 'replace' : 'push']({path: '/', query})
  if (next.page) list.value?.scrollTo({top: 0})
}
</script>

<template>
  <div ref="list" class="scrollpage view">
    <PageBar title="Projects">
      <SegmentedControl :model-value="filter.kind" :options="KINDS" label="Project kind" @update:model-value="kind => change({kind})" />
      <SegmentedControl :model-value="filter.state" :options="STATES" label="Project state" @update:model-value="state => change({state})" />
      <input type="search" placeholder="Find a project" aria-label="Find a project" :value="filter.text" @input="change({text: ($event.target as HTMLInputElement).value}, true)">
      <span v-if="data" class="muted num">{{ count }}</span>
    </PageBar>
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <template v-if="data">
      <div class="cards">
        <ProjectCard v-for="entry in shown" :key="projectRoot(entry.project)" :project="entry.project" :more="entry.others.length" :status="statusOf(entry.project)" @expand="expanded.add(entry.project.group)" />
        <div v-if="!shown.length" class="empty">{{ projects.length ? 'Nothing fits.' : 'No projects here yet - start one with: bun run init' }}</div>
      </div>
      <PageNumbers :page="page" :pages="pages" :first="first" :shown="shown.length" :total="entries.length" @go="n => change({...filter, page: n})" />
    </template>
  </div>
</template>
