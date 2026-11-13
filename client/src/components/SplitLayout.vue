<script setup lang="ts">
import {ref} from 'vue'

/**
 * A page in two columns (#915): what it is about on the left, a side column on the right - one column in a narrow window.
 * `full`: a page of its own between the top bar and the run dock (Library, References, Singers, Timing) - both columns scroll by
 * themselves, the side is a panel. Otherwise a grid within the page (Direction, Post-work). Classes prefixed (ui-split).
 */
withDefaults(
  defineProps<{
    /** the width of the side column: a length, or minmax(…) */
    side?: string
    full?: boolean
    /** the side column folded away (kept, not unmounted): the main column takes the width */
    folded?: boolean
    /** the side column stays in view while the main column scrolls */
    sticky?: boolean
    /** in a narrow window the side column comes first (it holds what is done on the page) */
    sideFirst?: boolean
    /** what the side column is, for a screen reader */
    label?: string
  }>(),
  {side: '460px', full: false, folded: false, sticky: false, sideFirst: false, label: undefined},
)
// the main column, for a page that scrolls in it or looks for its rows
const main = ref<HTMLElement>()
defineExpose({main})
</script>

<template>
  <div
    :class="['ui-split', {view: full, 'ui-split-full': full, 'ui-split-folded': folded, 'ui-split-sticky': sticky, 'ui-split-side-first': sideFirst}]"
    :style="{'--ui-split-side': side}"
  >
    <div ref="main" :class="full ? 'scrollpage' : 'ui-split-main'"><slot /></div>
    <aside v-show="!folded" :class="full ? 'detail' : 'ui-split-side'" :aria-label="label"><slot name="side" /></aside>
  </div>
</template>

<style scoped>
.ui-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--ui-split-side);
  gap: var(--space-5);
  align-items: start;
}
.ui-split-full {
  gap: 0;
  align-items: stretch;
  height: 100%;
  min-height: 0;
}
.ui-split-folded {
  grid-template-columns: minmax(0, 1fr);
}
.ui-split-main {
  min-width: 0;
}
.ui-split-side {
  min-width: 0;
}
.ui-split-sticky > .ui-split-side {
  position: sticky;
  top: 0;
}
@media (max-width: 960px) {
  .ui-split {
    grid-template-columns: minmax(0, 1fr);
  }
  .ui-split-sticky > .ui-split-side {
    position: static;
  }
  .ui-split-side-first > .ui-split-side {
    order: -1;
  }
}
</style>
