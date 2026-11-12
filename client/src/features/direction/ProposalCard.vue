<script setup lang="ts">
import {RouterLink, type RouteLocationRaw} from 'vue-router'
import type {DirectionView} from '../../../../shared/direction'
import PanelCard from '../../components/PanelCard.vue'
import {describeShot} from './directionItems'

/** What the language model proposes for the shots the instructions are about (#839): each shot before and after, taken or dropped. */
defineProps<{
  view: DirectionView & {proposal: NonNullable<DirectionView['proposal']>}
  blocked: boolean
  dirty: boolean
  name: (id: string) => string
  timeline: (shotId: string) => RouteLocationRaw
}>()
defineEmits<{take: []; drop: []}>()
</script>

<template>
  <PanelCard title="Proposed changes" :note="`${view.proposal.changes.length} shot(s)`" tone="accent">
    <p v-if="view.proposalStale" class="warn">This proposal belongs to an older plan or set of instructions. Preview again before taking it.</p>
    <p v-if="!view.proposal.changes.length" class="muted">No shot changes proposed.</p>
    <p v-for="conflict in view.proposal.conflicts" :key="conflict" class="warn">{{ conflict }}</p>
    <p v-if="view.proposal.conflicts.length" class="muted small">
      A rule that contradicts another: edit the instructions or widen their scope, then preview again. A note on continuity only: read it, and take the proposal
      anyway.
    </p>
    <article v-for="change in view.proposal.changes" :key="change.shotId" class="change">
      <h3>{{ change.shotId }} <RouterLink class="go" :to="timeline(change.shotId)">open in the timeline</RouterLink></h3>
      <div class="comparison">
        <div>
          <b>Before</b>
          <pre>{{ describeShot(change.before, name) }}</pre>
        </div>
        <div>
          <b>After</b>
          <pre>{{ describeShot(change.after, name) }}</pre>
        </div>
      </div>
    </article>
    <template #foot>
      <button class="btn primary" :disabled="blocked || dirty || view.proposalStale || !!view.unresolved.length" @click="$emit('take')">
        {{ view.proposal.conflicts.length ? 'Take anyway' : 'Take changes' }}</button
      ><button class="btn" :disabled="blocked" @click="$emit('drop')">Drop proposal</button>
    </template>
  </PanelCard>
</template>

<style scoped>
.change {
  border-top: 1px solid var(--line);
  padding: 8px 0;
}
.change h3 {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-s);
  font-weight: 600;
  color: var(--muted);
  margin: 2px 0;
}
.go {
  font-size: var(--text-s);
  font-weight: normal;
  color: var(--text);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.comparison pre {
  font: inherit;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 4px 0 0;
}
.small {
  font-size: var(--text-s);
}
@media (max-width: 700px) {
  .comparison {
    grid-template-columns: 1fr;
  }
}
</style>
