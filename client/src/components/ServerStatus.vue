<script setup lang="ts">
import {serverLabel, serverTitle, useServers} from '../services/servers'

const servers = useServers()
</script>

<template>
  <div class="servers" aria-label="Render servers">
    <span
      v-for="server in servers.list.value"
      :key="server.name"
      :class="['server', {down: !server.reachable, busy: server.reachable && (server.running || server.pending)}]"
      :title="serverTitle(server)"
    >
      <i /><span class="srv-name">{{ serverLabel(server) }}</span>
    </span>
  </div>
</template>
