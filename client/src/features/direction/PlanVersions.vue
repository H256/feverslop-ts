<script setup lang="ts">
import type {DirectionView} from '../../../../shared/direction'

/** The plan as taken (#839): the clip prompts built again, a version restored, and the same in the terminal. */
defineProps<{view: DirectionView; blocked: boolean; command: string}>()
defineEmits<{plan: []; restore: [string]}>()
</script>

<template>
  <div v-if="view.activeVersion" class="side-block">
    <h3>Accepted plan</h3>
    <p class="muted small">Taking or restoring builds the clip prompts again; render the affected clips on the timeline.</p>
    <button class="btn" :disabled="blocked || view.pending" @click="$emit('plan')">Build the clip prompts again</button>
  </div>
  <details v-if="view.versions.length" class="side-block">
    <summary>Plan versions ({{ view.versions.length }})</summary>
    <div v-for="version in [...view.versions].reverse()" :key="version.id" class="version-row">
      <span class="small"
        >{{ version.id.startsWith('baseline-') ? 'Original plan' : new Date(version.createdAt).toLocaleString() }} · {{ version.changes.length }} shot edits{{
          version.id === view.activeVersion ? ' · current' : ''
        }}</span
      ><button class="btn mini" :disabled="blocked || version.id === view.activeVersion" @click="$emit('restore', version.id)">Restore plan</button>
    </div>
  </details>
  <details class="side-block">
    <summary>CLI</summary>
    <pre class="cli"
      >{{ command }} --json
{{ command }} --show=SHOT
{{ command }} --add="..." --scope=shot:SHOT --preview --take
{{ command }} --with=CHARACTER --scope=shot:SHOT --preview --take
{{ command }} --without=CHARACTER --scope=beat:BEAT
{{ command }} --size=close --scope=shot:SHOT
{{ command }} --take --despite-conflicts
{{ command }} --drop</pre>
  </details>
</template>

<style scoped>
.side-block h3 {
  font-size: var(--text-s);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: 6px;
}
.side-block summary {
  cursor: pointer;
  color: var(--muted);
}
.side-block p {
  margin-bottom: 8px;
}
.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 6px 0;
  border-top: 1px solid var(--line);
}
.cli {
  font: var(--text-xs)/1.6 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 8px 0 0;
}
.small {
  font-size: var(--text-s);
}
</style>
