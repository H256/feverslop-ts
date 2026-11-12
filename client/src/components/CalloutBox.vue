<script setup lang="ts">
/**
 * A boxed word to the reader (#838): a note (grey), a warning (amber: needs doing again, check this) or an error (red: failed,
 * cannot go on). Prefixed (ui-callout): it replaces the global .note, .warn and .warn.bad. Its rules stay in styles/monitor.css,
 * where those were: the rules of a page (btn-row, castbar, u-mb-2, .role .ui-callout) come after them and set its margin, as before.
 */
withDefaults(defineProps<{kind?: 'note' | 'warn' | 'error'; as?: string}>(), {kind: 'note', as: 'p'})
</script>

<template>
  <component :is="as" :class="['ui-callout', `ui-callout-${kind}`]"><slot /></component>
</template>
