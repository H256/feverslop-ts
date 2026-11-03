<script setup lang="ts">
import {RouterLink} from 'vue-router'
import {usePageTitle} from '../services/chrome'

usePageTitle('Page not found')
</script>

<template>
  <div class="boot"><div><p>There is no such page.</p><p><RouterLink to="/">All projects</RouterLink></p></div></div>
</template>
