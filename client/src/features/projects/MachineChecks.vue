<script setup lang="ts">
import type {MachineCheck} from '../../../../shared/workspace'
import {byUrgency} from './newProject'

/** What this machine has of what a video needs, and what to do about the rest: the lines of `bun run doctor` (#831). */
defineProps<{checks: MachineCheck[]}>()
const MARK = {ready: '✔', missing: '✗', note: '·'} as const
</script>

<template>
  <ul class="mc-list">
    <li v-for="check in byUrgency(checks)" :key="check.what" :class="['mc-row', `mc-${check.state}`]">
      <span class="mc-mark" aria-hidden="true">{{ MARK[check.state] }}</span>
      <div>
        <b>{{ check.what }}</b>
        <span class="mc-found">{{ check.found }}</span>
        <code v-if="check.fix" class="mc-fix">{{ check.fix }}</code>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.mc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
  min-width: 0;
}
.mc-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.mc-mark {
  font-weight: 700;
}
.mc-ready .mc-mark {
  color: var(--ok);
}
.mc-missing .mc-mark {
  color: var(--danger);
}
.mc-note .mc-mark {
  color: var(--muted);
}
.mc-found {
  display: block;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.mc-fix {
  display: inline-block;
  margin-top: 2px;
  font-size: 12px;
}
</style>
