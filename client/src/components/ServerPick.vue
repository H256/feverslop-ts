<script setup lang="ts">
import {serverLoad, useServers} from '../services/servers'

/** Which render servers a run may use: only reachable ones can be ticked. */
const chosen = defineModel<string[]>({required: true})
const servers = useServers()
</script>

<template>
  <fieldset class="pick">
    <legend>Render on</legend>
    <label v-for="server in servers.list.value" :key="server.name" :class="{down: !server.reachable}">
      <input v-model="chosen" type="checkbox" :value="server.name" :disabled="!server.reachable">
      <span>{{ server.name }}</span>
      <span class="muted num">{{ server.reachable ? serverLoad(server) : 'not reachable' }}</span>
    </label>
  </fieldset>
</template>
