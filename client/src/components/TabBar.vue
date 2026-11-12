<script setup lang="ts" generic="T extends string">
/** Tabs above a panel (#838): the one shown underlined, a count next to a name when there is one. Prefixed (ui-tabs). */
defineProps<{
  tabs: readonly {id: T; label: string; count?: number}[]
  /** inset from the edges of a side panel */
  inset?: boolean
}>()
const model = defineModel<T>({required: true})
</script>

<template>
  <div :class="['ui-tabs', {'ui-tabs-inset': inset}]" role="tablist">
    <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="model === t.id" @click="model = t.id">
      {{ t.label }}<small v-if="t.count">{{ t.count }}</small>
    </button>
  </div>
</template>

<style scoped>
.ui-tabs {
  display: flex;
  gap: var(--space-half);
  border-bottom: 1px solid var(--line);
}
.ui-tabs-inset {
  padding: 0 10px;
}
.ui-tabs button {
  padding: 7px 8px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  margin-bottom: -1px;
  cursor: pointer;
}
.ui-tabs button:hover {
  color: var(--text);
}
.ui-tabs button[aria-selected='true'] {
  color: var(--text);
  border-color: var(--accent);
  font-weight: 500;
}
.ui-tabs small {
  color: var(--muted);
  font-size: var(--text-xs);
  margin-left: 2px;
}
</style>
