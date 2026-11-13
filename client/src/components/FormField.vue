<script setup lang="ts">
/**
 * A labelled field (#915): the label above, the control in the slot, a note under it when there is one. `check`: a checkbox and
 * its words in one row, the box first. One look for every form - no page writes its own label.
 */
withDefaults(defineProps<{label: string; note?: string; check?: boolean}>(), {note: undefined, check: false})
</script>

<template>
  <label v-if="check" class="field field-check"
    ><slot /><span>{{ label }}</span></label
  >
  <label v-else class="field"
    ><span>{{ label }}</span
    ><slot /><small v-if="note" class="field-note">{{ note }}</small></label
  >
</template>
