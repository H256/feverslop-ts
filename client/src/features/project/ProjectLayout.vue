<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink, RouterView, useRoute} from 'vue-router'
import type {ProjectKind} from '../../../../shared/workspace'
import ResourceState from '../../components/ResourceState.vue'
import {useResource} from '../../composables/useResource'
import {TOP_NAV, usePageTitle} from '../../services/chrome'
import {useRunDock} from '../../services/run'
import {useServers} from '../../services/servers'
import {createProjectSession, ProjectService} from './session'

/** Every page of one project: the session they share, the project's pages in the top bar, its runs followed. */
const route = useRoute()
const run = useRunDock()
const session = ProjectService.provide(createProjectSession(route.params.kind as ProjectKind, String(route.params.id), {run, servers: useServers()}))
const {reload, error, loading} = useResource(signal => session.reload(signal))
run.follow({events: session.api.events, stop: session.api.stop})
// what a run changed is read again: every page shows the folder as it is now
run.onEnd(() => { void reload() })

const project = session.project
usePageTitle(() => project.value?.title ?? session.id)
// in the order a film is made: the book, who plays, who sings, how it looks - the timeline is where it all comes together
const pages = computed(() => {
  const p = project.value
  return [
    {name: 'timeline', label: 'Timeline', path: ''},
    {name: 'story', label: p?.kind === 'film' ? 'Screenplay' : 'Story', path: 'story'},
    {name: 'casting', label: 'Casting', path: 'casting'},
    ...(p?.sings ? [{name: 'singers', label: 'Singers', path: 'singers'}] : []),
    ...(p?.timed ? [{name: 'timing', label: 'Timing', path: 'timing'}] : []),
    {name: 'look', label: 'Look', path: 'look'},
    {name: 'references', label: 'References', path: 'references'},
  ]
})
</script>

<template>
  <Teleport :to="TOP_NAV" defer>
    <RouterLink v-for="page in pages" :key="page.name" :to="`${session.root}/${page.path}`" :aria-current="route.name === page.name ? 'page' : undefined">{{ page.label }}</RouterLink>
  </Teleport>
  <RouterView v-if="project" />
  <div v-else class="scrollpage"><ResourceState :loading="loading" :error="error" :loaded="false" @retry="reload" /></div>
</template>
