<script setup lang="ts">
import {onScopeDispose} from 'vue'
import {RouterView, type RouteLocationNormalizedLoaded} from 'vue-router'
import AskDialog from './components/AskDialog.vue'
import MediaViewer from './components/MediaViewer.vue'
import RunDock from './components/RunDock.vue'
import ToastHost from './components/ToastHost.vue'
import TopBar from './components/TopBar.vue'
import {usePolling} from './composables/usePolling'
import {AskService, createAsk} from './services/ask'
import {ChromeService, createChrome} from './services/chrome'
import {createRunDock, RunService} from './services/run'
import {createServers, ServersService} from './services/servers'
import {createToasts, ToastsService} from './services/toasts'
import {createViewer, ViewerService} from './services/viewer'

// the services of the shell: made here once, for every page
const chrome = ChromeService.provide(createChrome())
const toasts = ToastsService.provide(createToasts())
const ask = AskService.provide(createAsk())
const viewer = ViewerService.provide(createViewer())
const servers = ServersService.provide(createServers())
const run = RunService.provide(createRunDock(toasts))
void servers.refresh()
usePolling(servers.refresh, 10_000, {onFocus: false})
onScopeDispose(() => {
  run.dispose()
  toasts.dispose()
  chrome.dispose()
})

// another project is another page: nothing of the one before goes on in it. Filters, hashes and its own pages are not
const pageKey = (route: RouteLocationNormalizedLoaded) =>
  route.params.id ? `p:${String(route.params.kind)}/${String(route.params.id)}` : String(route.matched[0]?.path ?? route.path)
</script>

<template>
  <div class="app">
    <TopBar />
    <div class="page">
      <RouterView v-slot="{Component, route}">
        <component :is="Component" :key="pageKey(route)" />
      </RouterView>
    </div>
    <RunDock />
  </div>
  <AskDialog v-if="ask.current.value" :key="ask.current.value.id" :request="ask.current.value" />
  <MediaViewer v-if="viewer.shown.value" :shown="viewer.shown.value" @close="viewer.close" />
  <ToastHost />
</template>
