<script setup lang="ts">
import CalloutBox from '../../components/CalloutBox.vue'
import {computed, h, reactive, ref} from 'vue'
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
import {useAsk} from '../../services/ask'
import MachineChecks from './MachineChecks.vue'
import MachineServers from './MachineServers.vue'
import NewFilmForm from './NewFilmForm.vue'
import NewProjectForm from './NewProjectForm.vue'
import {newFilmDraft, newFilmProblem, newFilmRequest} from './newFilm'
import {machineSummary, newProjectDraft, newProjectProblem, newProjectRequest} from './newProject'

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

// what this machine has of what a video needs (bun run doctor, #831): asked once when the page opens, and again from its dialog
const ask = useAsk()
const machine = useResource(signal => workspace.doctor(signal))
const checks = computed(() => machine.data.value?.checks ?? [])
const missing = computed(() => checks.value.filter(check => check.state === 'missing'))
const showMachine = async () => {
  void machine.reload()
  await ask({
    title: 'This machine',
    lines: ['What a video needs, and what to do about what is not there. The same as: bun run doctor'],
    // the servers can be set here too (#831): a change is checked again at once
    body: () => h('div', [h(MachineChecks, {checks: checks.value}), h(MachineServers, {onChanged: () => void machine.reload()})]),
    confirm: 'Close',
  })
}
/** A new music video: the form becomes the options of `bun run init`, and the page goes to the project it made. */
const newProject = async () => {
  const draft = reactive(newProjectDraft())
  // the ids there are: a new one is not one of them (#939)
  const taken = projects.value.filter(p => p.kind === 'music').map(p => p.id)
  // the songs of the library a project can start from (#835) - none when the library cannot be read
  const songs = (await workspace.library().catch(() => undefined))?.songs ?? []
  const made = await ask({
    title: 'New music video',
    lines: ['Writes projects/<id>/ with what you give here. Nothing is planned or rendered yet.'],
    body: () => h(NewProjectForm, {draft, songs, taken}),
    confirm: 'Create',
    submit: async () => {
      const problem = newProjectProblem(draft, taken)
      if (problem) throw new Error(problem)
      await workspace.createProject(newProjectRequest(draft))
    },
  })
  if (made) await router.push(`/p/music/${draft.id.trim()}/story`)
}

/** A new film: the form becomes the options of `bun run film:init` (#831). */
const newFilm = async () => {
  const draft = reactive(newFilmDraft())
  const made = await ask({
    title: 'New film',
    lines: ['Writes films/<id>/ with what you give here. Nothing is planned or rendered yet.'],
    body: () => h(NewFilmForm, {draft}),
    confirm: 'Create',
    submit: async () => {
      const problem = newFilmProblem(draft)
      if (problem) throw new Error(problem)
      await workspace.createFilm(newFilmRequest(draft))
    },
  })
  if (made) await router.push(`/p/film/${draft.id.trim()}/story`)
}

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
      <div class="spacer" />
      <button class="btn" :title="machine.data.value ? machineSummary(checks) : 'What this machine has of what a video needs'" @click="showMachine">
        Machine<span v-if="missing.length" class="chip bad pp-count">{{ missing.length }} missing</span>
      </button>
      <button class="btn" @click="newFilm">New film</button>
      <button class="btn primary" @click="newProject">New music video</button>
    </PageBar>
    <!-- something a run needs is not there: said before a first run fails on it -->
    <CalloutBox v-if="missing.length" kind="warn" as="div" class="pp-machine">
      <span>{{ missing[0]!.what }}: {{ missing[0]!.found }}</span>
      <code v-if="missing[0]!.fix">{{ missing[0]!.fix }}</code>
      <button class="btn mini" @click="showMachine">{{ missing.length > 1 ? `All ${missing.length}` : 'Details' }}</button>
    </CalloutBox>
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <template v-if="data">
      <div class="cards">
        <ProjectCard v-for="entry in shown" :key="projectRoot(entry.project)" :project="entry.project" :more="entry.others.length" :status="statusOf(entry.project)" @expand="expanded.add(entry.project.group)" />
        <div v-if="!shown.length && projects.length" class="empty">Nothing fits.</div>
        <div v-if="!projects.length" class="empty pp-first">
          <b>No projects here yet.</b>
          <ol>
            <li>See what this machine has: <button class="btn mini" @click="showMachine">Machine</button> - the servers are set up in the terminal with <code>bun run setup</code>.</li>
            <li>
              Start a music video or a film: <button class="btn mini primary" @click="newProject">New music video</button>
              <button class="btn mini" @click="newFilm">New film</button> - or <code>bun run init</code>, <code>bun run film:init</code>.
            </li>
            <li>Plan it stage by stage on the project's pages, then render.</li>
          </ol>
        </div>
      </div>
      <PageNumbers :page="page" :pages="pages" :first="first" :shown="shown.length" :total="entries.length" @go="n => change({...filter, page: n})" />
    </template>
  </div>
</template>

<style scoped>
.pp-count {
  margin-left: 6px;
}
.pp-machine {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 12px;
}
.pp-first {
  text-align: left;
  grid-column: 1 / -1;
  max-width: 640px;
}
.pp-first ol {
  margin: 8px 0 0;
  padding-left: 20px;
  display: grid;
  gap: var(--space-2);
}
</style>
