<script setup lang="ts">
import {computed} from 'vue'
import type {DirectionChange, DirectionView} from '../../../../shared/direction'
import {shotDiff} from './directionItems'

/** What is proposed for one shot (#839), field by field - only what changed - taken (the clip prompts built again) or dropped. */
const props = defineProps<{change: DirectionChange; view: DirectionView; otherChanges: number; blocked: boolean; name: (id: string) => string}>()
defineEmits<{take: []; drop: []}>()
const diff = computed(() => shotDiff(props.change.before, props.change.after, props.name))
</script>

<template>
  <section class="list">
    <h3>Proposed</h3>
    <table class="diff">
      <tr v-for="row in diff" :key="row.label">
        <th>{{ row.label }}</th>
        <td class="before">{{ row.before }}</td>
        <td class="after">{{ row.after }}</td>
      </tr>
    </table>
    <p v-if="!diff.length" class="muted">The shot already does what was asked - nothing changes.</p>
    <p v-for="c in view.proposal?.conflicts ?? []" :key="c" class="sd-issue">{{ c }}</p>
    <p v-if="otherChanges" class="muted">The proposal changes {{ otherChanges }} more shot(s) - see Direction.</p>
    <div class="btn-row">
      <button
        class="btn primary"
        :disabled="blocked || !!view.proposalStale || !!view.unresolved.length"
        :title="view.proposal?.conflicts.length ? 'The model notes a conflict above. Taking it keeps the proposal as it is' : undefined"
        @click="$emit('take')"
      >
        {{ view.proposal?.conflicts.length ? 'Take anyway and build the prompts' : 'Take and build the prompts' }}
      </button>
      <button class="btn" :disabled="blocked" @click="$emit('drop')">Drop</button>
    </div>
  </section>
</template>

<style scoped>
h3 {
  margin: 22px 0 8px;
  font-size: var(--text-s);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.sd-issue {
  color: var(--text);
  border-left: 3px solid var(--stale);
  padding-left: 10px;
  margin: 6px 0;
}
.diff {
  width: 100%;
  border-collapse: collapse;
}
.diff th {
  text-align: left;
  vertical-align: top;
  padding: 6px 10px 6px 0;
  color: var(--muted);
  font-weight: normal;
  white-space: nowrap;
}
.diff td {
  vertical-align: top;
  padding: 6px 8px;
  width: 50%;
}
.diff .before {
  text-decoration: line-through;
  color: var(--muted);
}
.diff .after {
  background: var(--raised);
}
@media (max-width: 600px) {
  .diff th,
  .diff td {
    display: block;
    width: auto;
  }
}
</style>
