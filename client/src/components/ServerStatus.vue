<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink} from 'vue-router'
import {serverLabel, serverTitle, useServers} from '../services/servers'

const servers = useServers()
// no render server set up and none at the default address: said so, with the way to set one up - not a red "down" (#831)
const unset = computed(() => servers.list.value.length > 0 && servers.list.value.every(server => server.unset && !server.reachable))
</script>

<template>
  <div class="servers" aria-label="Render servers">
    <RouterLink v-if="unset" to="/" class="server ss-unset" title="Set up a ComfyUI server on the start page: Machine - or bun run setup comfy --add=URL"
      >No render server set up</RouterLink
    >
    <span
      v-for="server in unset ? [] : servers.list.value"
      :key="server.name"
      :class="['server', {down: !server.reachable, busy: server.reachable && (server.running || server.pending)}]"
      :title="serverTitle(server)"
    >
      <i /><span class="srv-name">{{ serverLabel(server) }}</span>
    </span>
  </div>
</template>

<style scoped>
/* no server set up: a way to set one up, not a fault */
.ss-unset {
  color: var(--muted);
  text-decoration: underline;
}
</style>
