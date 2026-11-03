<script setup lang="ts">
import {RouterLink} from 'vue-router'
import {ChromeService} from '../services/chrome'
import AppIcon from './AppIcon.vue'
import ServerStatus from './ServerStatus.vue'
import ThemeSwitch from './ThemeSwitch.vue'

/** The bar on top of every page. A project puts its own pages and chips into #top-nav and #top-chips. */
const {title} = ChromeService.use()
</script>

<template>
  <header class="top">
    <RouterLink class="mark" to="/" title="All projects" aria-label="All projects"><AppIcon name="mark" :size="11" /></RouterLink>
    <h1>{{ title }}</h1>
    <nav id="top-nav" class="nav" aria-label="Project" />
    <div id="top-chips" class="chips" />
    <div class="spacer" />
    <ServerStatus />
    <nav class="nav" aria-label="Workspace">
      <RouterLink to="/" active-class="" exact-active-class="" :aria-current="$route.path === '/' ? 'page' : undefined">Projects</RouterLink>
      <RouterLink to="/library" :aria-current="$route.path === '/library' ? 'page' : undefined">Library</RouterLink>
    </nav>
    <ThemeSwitch />
  </header>
</template>
