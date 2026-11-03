<script setup lang="ts">
import {RouterLink, RouterView} from 'vue-router'
</script>

<template>
  <header>
    <strong>Workspace</strong>
    <nav aria-label="Workspace"><RouterLink to="/">Projects</RouterLink><RouterLink to="/library">Library</RouterLink></nav>
  </header>
  <main><RouterView /></main>
</template>
