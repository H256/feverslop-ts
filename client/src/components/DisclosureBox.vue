<script setup lang="ts">
/**
 * Something folded away until asked for (#915): a title to click, what it holds below - a <details> of one look. `quiet`: a
 * muted title (who is in the shot, plan versions, the CLI); `small`: in the small type. `v-model:open` for a page that opens it
 * itself. Classes prefixed (ui-disclosure). A menu (the run dock's warnings, Timing's Reset ▾) and Post-work's steps (one open at a
 * time) are not this.
 */
withDefaults(defineProps<{title: string; quiet?: boolean; small?: boolean}>(), {quiet: false, small: false})
const open = defineModel<boolean>('open', {default: false})
</script>

<template>
  <details
    :class="['ui-disclosure', {'ui-disclosure-quiet': quiet, 'ui-disclosure-small': small}]"
    :open="open"
    @toggle="open = ($event.target as HTMLDetailsElement).open"
  >
    <summary>{{ title }}<slot name="summary" /></summary>
    <slot />
  </details>
</template>

<style scoped>
.ui-disclosure > summary {
  cursor: pointer;
  padding: 4px 0;
}
.ui-disclosure-quiet > summary {
  color: var(--muted);
}
.ui-disclosure-small > summary {
  font-size: var(--text-s);
}
</style>
