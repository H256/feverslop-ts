<script setup lang="ts">
/**
 * A card of a page (#838): a title with a note, what it holds, and its actions below. One look for the cards of Direction, Look and
 * Post-work - a page says what a card is (tone, bar), never how it is drawn. Classes prefixed (ui-card): .card is the project card.
 */
withDefaults(
  defineProps<{
    title?: string
    /** said next to the title, two lines at most - the whole of it on hover */
    note?: string
    /** accent: to act on; stale: to decide; quiet: nothing to do */
    tone?: 'accent' | 'stale' | 'quiet'
    /** a bar on the left: line, or the colour of its state */
    bar?: 'line' | 'accent' | 'ok'
    /** no padding: what it holds fills it to the edge (a step that opens) */
    flush?: boolean
    as?: string
  }>(),
  {title: undefined, note: undefined, tone: undefined, bar: undefined, as: 'section'},
)
</script>

<template>
  <component :is="as" :class="['ui-card', tone && `ui-card-${tone}`, bar && `ui-card-bar ui-card-bar-${bar}`, {'ui-card-flush': flush}]">
    <header v-if="title || $slots.head" class="ui-card-head">
      <h2 v-if="title">{{ title }}</h2>
      <span v-if="note" class="ui-card-note" :title="note">{{ note }}</span>
      <slot name="head" />
    </header>
    <slot />
    <footer v-if="$slots.foot" class="ui-card-foot"><slot name="foot" /></footer>
  </component>
</template>

<style scoped>
.ui-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--surface);
  padding: 12px 14px;
}
.ui-card-flush {
  padding: 0;
}
.ui-card-accent {
  border-color: var(--accent);
}
.ui-card-stale {
  border-color: var(--stale);
}
.ui-card-quiet {
  background: var(--raised);
}
.ui-card-bar {
  border-left-width: 3px;
}
.ui-card-bar-accent {
  border-left-color: var(--accent);
}
.ui-card-bar-ok {
  border-left-color: var(--ok);
}
.ui-card-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.ui-card-head h2 {
  margin: 0;
  font-size: var(--text-l);
  font-weight: 600;
  white-space: nowrap;
}
.ui-card-note {
  flex: 1 1 0;
  min-width: 0;
  color: var(--muted);
  font-size: var(--text-s);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ui-card-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
