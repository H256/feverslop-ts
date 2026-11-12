<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink, useRoute} from 'vue-router'
import {ChromeService} from '../services/chrome'
import mark from '../assets/mark.png'
import ServerStatus from './ServerStatus.vue'
import ThemeSwitch from './ThemeSwitch.vue'

/**
 * The bar on top of every page (#776), in the order it is read: where you are (the workspace's pages, then the project), the
 * project's pages as tabs, and the machine (servers, theme, release) on the right. A project puts its pages into #top-nav and its
 * status chips into #top-chips - a slim row of their own under the bar, there only when it has chips.
 */
const {title, themeChanged} = ChromeService.use()
const version = __APP_VERSION__
const route = useRoute()
const workspacePage = computed(() => ['/', '/library', '/stats'].includes(route.path))
</script>

<template>
  <header class="topwrap">
    <div class="top">
      <RouterLink class="mark" to="/" title="All projects" aria-label="All projects"><img :src="mark" alt="" /></RouterLink>
      <nav class="crumbs" aria-label="Workspace">
        <RouterLink to="/" active-class="" exact-active-class="" :aria-current="$route.path === '/' ? 'page' : undefined">Projects</RouterLink>
        <RouterLink to="/library" :aria-current="$route.path === '/library' ? 'page' : undefined">Library</RouterLink>
        <RouterLink to="/stats" :aria-current="$route.path === '/stats' ? 'page' : undefined">Stats</RouterLink>
      </nav>
      <!-- on the workspace's own pages the crumbs say where you are already -->
      <template v-if="!workspacePage">
        <span class="crumb-sep" aria-hidden="true">›</span>
        <h1>{{ title }}</h1>
      </template>
      <nav id="top-nav" class="nav tabs" aria-label="Project" />
      <div class="spacer" />
      <div class="machine">
        <ServerStatus />
        <ThemeSwitch @changed="themeChanged" />
        <span class="release" title="The release of this workspace">v{{ version }}</span>
      </div>
    </div>
    <div id="top-chips" class="chips subbar" />
  </header>
</template>
