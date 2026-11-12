<script setup lang="ts">
import {computed, watch} from 'vue'
import {RouterLink, RouterView, useRoute, useRouter} from 'vue-router'
import type {PlanStage, ProjectKind, ProjectPage} from '../../../../shared/workspace'
import ResourceState from '../../components/ResourceState.vue'
import {useResource} from '../../composables/useResource'
import {TOP_CHIPS, TOP_NAV, usePageTitle} from '../../services/chrome'
import {useRunDock} from '../../services/run'
import {useServers} from '../../services/servers'
import {changedStages, STAGE_PAGE, STAGES, stageName} from '../plan/stages'
import NextStep from './NextStep.vue'
import {createProjectSession, ProjectService} from './session'

/** Every page of one project: the session they share, the project's pages in the top bar, its runs followed. */
const route = useRoute()
const run = useRunDock()
const session = ProjectService.provide(createProjectSession(route.params.kind as ProjectKind, String(route.params.id), {run, servers: useServers()}))
const {reload, error, loading} = useResource(signal => session.reload(signal))
run.follow({events: session.api.events, stop: session.api.stop, progress: session.api.progress})
// what a run changed is read again: every page shows the folder as it is now
run.onEnd(() => {
  void reload()
})

const project = session.project
usePageTitle(() => project.value?.title ?? session.id)
// the tabs in the order a video is made (#833): planned, shot, published - the settings apart on the right
type Tab = {name: string; label: string; path: '' | ProjectPage; stage?: PlanStage}
type Group = {name: 'Plan' | 'Shoot' | 'Publish' | 'Settings'; tabs: Tab[]}
const groups = computed((): Group[] => {
  const p = project.value
  return [
    {
      name: 'Plan',
      tabs: [
        {name: 'story', label: p?.kind === 'film' ? 'Screenplay' : 'Story', path: 'story', stage: 'story'},
        {name: 'casting', label: 'Casting', path: 'casting', stage: 'cast'},
        ...(p?.sings ? ([{name: 'singers', label: 'Singers', path: 'singers'}] satisfies Tab[]) : []),
        ...(p?.timed ? ([{name: 'timing', label: 'Timing', path: 'timing'}] satisfies Tab[]) : []),
        {name: 'look', label: 'Look', path: 'look', stage: 'look'},
      ],
    },
    {
      name: 'Shoot',
      tabs: [
        {name: 'references', label: 'References', path: 'references'},
        {name: 'timeline', label: 'Timeline', path: '', stage: 'plan'},
        {name: 'direction', label: 'Direction', path: 'direction'},
      ],
    },
    {name: 'Publish', tabs: [{name: 'postwork', label: 'Post-work', path: 'postwork'}]},
    {name: 'Settings', tabs: [{name: 'settings', label: 'Settings', path: 'settings'}]},
  ]
})
// what `bun run status` says - the next-step bar and the tabs read it; a run or a change on a page can change it
watch(project, () => void session.loadStatus(), {immediate: true})
run.onEnd(() => void session.loadStatus())
// a stage's tab says where the plan stands: done, done but changed since (a changed input or setting makes it again), or the
// one a plan run makes next - what the stage bar said (#833)
const stateOf = (tab: Tab): 'done' | 'changed' | 'next' | undefined => {
  const plan = project.value?.plan
  if (!tab.stage || !plan) return undefined
  if (plan.stage && STAGES.indexOf(tab.stage) <= STAGES.indexOf(plan.stage))
    return changedStages(session.status.value?.steps ?? [], project.value!.kind).includes(tab.stage) ? 'changed' : 'done'
  return plan.next === tab.stage ? 'next' : undefined
}
const titleOf = (tab: Tab) => {
  const state = stateOf(tab)
  const kind = project.value?.kind ?? 'music'
  if (!tab.stage || !state) return undefined
  const name = stageName(tab.stage, kind)
  if (state === 'changed') return `${name}: planned, changed since - the next plan run makes it again`
  return state === 'done' ? `${name}: planned` : `${name}: planned next`
}

// a project that is not planned yet opens on the page of its next stage, not on an empty timeline - once, as it is opened
const router = useRouter()
const stopOpening = watch(project, p => {
  if (!p) return
  stopOpening()
  const next = p.plan.next
  if (route.name === 'timeline' && next && next !== 'plan' && !p.clips.length) void router.replace(`${session.root}/${STAGE_PAGE[next]}`)
})
</script>

<template>
  <Teleport :to="TOP_NAV" defer>
    <template v-for="(group, n) in groups" :key="group.name">
      <span v-if="n" :class="['pl-gap', {'pl-apart': group.name === 'Settings'}]" aria-hidden="true" />
      <RouterLink
        v-for="tab in group.tabs"
        :key="tab.name"
        :to="`${session.root}/${tab.path}`"
        :aria-current="route.name === tab.name ? 'page' : undefined"
        :title="titleOf(tab)"
        :class="['pl-tab', stateOf(tab) && `pl-${stateOf(tab)}`]"
        >{{ tab.label }}</RouterLink
      >
    </template>
  </Teleport>
  <Teleport v-if="project" :to="TOP_CHIPS" defer><NextStep /></Teleport>
  <RouterView v-if="project" />
  <div v-else class="scrollpage"><ResourceState :loading="loading" :error="error" :loaded="false" @retry="reload" /></div>
</template>

<style>
/* not scoped: the tabs are teleported into the top bar. Prefixed (pl-), so that no rule of workspace.css reaches them */
.top .tabs .pl-gap {
  width: 1px;
  margin: 10px 6px;
  background: var(--line);
}
.top .tabs .pl-apart {
  margin-left: auto;
}
.top .tabs .pl-tab.pl-done::before {
  content: '✓';
  margin-right: 4px;
  color: var(--ok);
}
/* planned, but a changed input or setting makes it again with the next plan run */
.top .tabs .pl-tab.pl-changed::before {
  content: '⟳';
  margin-right: 4px;
  color: var(--stale);
}
.top .tabs .pl-tab.pl-next::before {
  content: '●';
  margin-right: 4px;
  color: var(--accent);
  transform: scale(0.6);
}
/* the next step: at the right end of the row under the tabs, beside the chips of a page */
.ns-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2, 8px);
  /* after the chips of a page, the rest of their row */
  order: 99;
  flex: 1 1 360px;
  min-width: 0;
}
/* a narrow window: the tabs closer together, so that the last one is not cut off */
@media (max-width: 1300px) {
  .top .tabs .pl-tab {
    padding: 0 7px;
  }
}
@media (max-width: 1200px) {
  .top .tabs .pl-tab {
    padding: 0 5px;
  }
}
.ns-label {
  font-weight: 600;
}
/* what is next is read first: the estimate gives way when the row is short */
.ns-why {
  flex: 0 0 auto;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ns-estimate {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
