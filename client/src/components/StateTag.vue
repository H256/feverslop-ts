<script setup lang="ts">
/** A small outlined word about a thing (#838): "edit", "made", a name. Muted unless its state says more. Prefixed (ui-tag). */
defineProps<{state?: 'plain' | 'ok' | 'stale' | 'bad'}>()
</script>

<template>
  <span :class="['ui-tag', state && `ui-tag-${state}`]"><slot /></span>
</template>

<style scoped>
.ui-tag {
  font-size: var(--text-xs);
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  color: var(--muted);
  white-space: nowrap;
}
.ui-tag-plain {
  color: var(--text);
}
.ui-tag-ok {
  color: var(--ok);
}
.ui-tag-stale {
  color: var(--stale);
  border-color: var(--stale);
}
.ui-tag-bad {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
