<script setup lang="ts">
import {RouterLink, type RouteLocationRaw} from 'vue-router'
import type {DirectionEdit, DirectionRule} from '../../../../shared/direction'
import {withNames} from '../../lib/format'
import {scopeText, type Item} from './directionItems'

/**
 * One instruction or edit of the Direction page (#839), as one of four: in the list (`active`), only for the planner (`planned`),
 * left over from an old plan (`leftover`), or to decide (`review`). What it does is said to the page as events.
 */
const props = defineProps<{
  item: Item
  as: 'active' | 'planned' | 'leftover' | 'review'
  name: (id: string) => string
  blocked: boolean
  dirty?: boolean
  /** a shot's place on the timeline, for an item to decide */
  timeline?: RouteLocationRaw
}>()
defineEmits<{edit: [DirectionRule]; remove: [DirectionRule]; undo: [DirectionEdit]; rebind: [DirectionRule]; clear: [Item]}>()
// an item listed apart from its group says what it is about, and whom
const apart = props.as === 'leftover' || props.as === 'review'
</script>

<template>
  <div :class="['item', {'muted-item': as === 'planned' || as === 'leftover'}]">
    <div class="what">
      <span v-if="apart" class="where">{{ scopeText(item.scope) }}</span>
      <RouterLink v-if="as === 'review' && item.scope.kind === 'shot' && timeline" class="go" :to="timeline">open in the timeline</RouterLink>
      <span v-if="as === 'planned'" class="dp-tag">in the plan</span>
      <template v-if="as === 'active'">
        <span v-if="item.edit" class="dp-tag">edit</span>
        <span v-if="item.rule?.characterId" class="dp-tag dp-who">{{ name(item.rule.characterId) }}</span>
      </template>
      <p>{{ apart && item.rule?.characterId ? `${name(item.rule.characterId)}: ` : '' }}{{ withNames(item.text) }}</p>
      <template v-if="as !== 'leftover'">
        <p v-for="issue in item.issues" :key="issue" class="issue">{{ issue }}</p>
      </template>
    </div>
    <div class="acts">
      <template v-if="as === 'leftover'">
        <button
          v-if="item.rule"
          class="btn mini"
          :disabled="blocked"
          title="Apply this instruction to the shot as it is now"
          @click="$emit('rebind', item.rule)"
        >
          Keep for the new shot
        </button>
        <button class="btn mini" :disabled="blocked" @click="$emit('clear', item)">Clear</button>
      </template>
      <button
        v-else-if="as === 'planned'"
        v-show="item.rule"
        class="btn mini"
        :disabled="blocked"
        aria-label="Remove instruction"
        @click="$emit('remove', item.rule!)"
      >
        Remove
      </button>
      <template v-else-if="item.rule">
        <button class="btn mini" :disabled="blocked || dirty" aria-label="Edit instruction" @click="$emit('edit', item.rule)">Edit</button>
        <button class="btn mini" :disabled="blocked" aria-label="Remove instruction" @click="$emit('remove', item.rule)">Remove</button>
      </template>
      <button v-else-if="item.edit" class="btn mini" :disabled="blocked" aria-label="Undo edit" @click="$emit('undo', item.edit)">Undo</button>
    </div>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: 6px 0;
}
.item + .item {
  border-top: 1px dashed var(--line);
}
.what {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}
.what p {
  flex: 1 1 100%;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.what .dp-tag + p,
.what .dp-tag.dp-who + p {
  flex: 1 1 0;
}
.where {
  font-weight: 600;
}
.issue {
  color: var(--stale);
  font-size: var(--text-s);
}
.dp-tag {
  font-size: var(--text-xs);
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  color: var(--muted);
  white-space: nowrap;
}
.dp-tag.dp-who {
  color: var(--text);
}
.acts {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
}
.muted-item {
  opacity: 0.7;
}
.go {
  font-size: var(--text-s);
  font-weight: normal;
  color: var(--text);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
