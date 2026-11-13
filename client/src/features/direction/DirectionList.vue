<script setup lang="ts">
import DisclosureBox from '../../components/DisclosureBox.vue'
import {computed} from 'vue'
import {RouterLink, type RouteLocationRaw} from 'vue-router'
import type {DirectionEdit, DirectionRule, DirectionView} from '../../../../shared/direction'
import {withNames} from '../../lib/format'
import PanelCard from '../../components/PanelCard.vue'
import DirectionItem from './DirectionItem.vue'
import {groupItems, shotGroup, shotNumber, type Item} from './directionItems'

/**
 * The instructions and edits of the Direction page (#783, #802, #839): the leftovers of an old plan, cleared in one go; what is to
 * decide; then everything by what it is about - the whole video, a character, a stretch of the song, beat by beat (scene by scene)
 * and in it shot by shot. Instructions only for the planner are folded away.
 */
const props = defineProps<{
  view: DirectionView
  items: Item[]
  shown: Item[]
  name: (id: string) => string
  blocked: boolean
  dirty: boolean
  timeline: (shotId: string) => RouteLocationRaw
}>()
defineEmits<{edit: [DirectionRule]; remove: [DirectionRule]; undo: [DirectionEdit]; rebind: [DirectionRule]; clear: [Item?]}>()

const leftovers = computed(() => props.items.filter(item => item.leftover))
const review = computed(() => props.shown.filter(item => item.issues.length && !item.leftover && !item.writes))
const leftoverBeats = computed(() => [...new Set(leftovers.value.flatMap(i => ('id' in i.scope ? [shotGroup(i.scope.id)] : [])))].join(', '))
const grouped = computed(() => groupItems(props.shown, props.view, props.name))
const plannedOf = (list: Item[]) => list.filter(item => item.planned)
const activeOf = (list: Item[]) => list.filter(item => !item.planned)
</script>

<template>
  <PanelCard v-if="leftovers.length" title="Left over from the old plan" tone="quiet">
    <template #head>
      <div class="spacer" />
      <button class="btn primary" :disabled="blocked" @click="$emit('clear')">Clear them out</button>
    </template>
    <p class="muted small">
      {{ leftoverBeats }} {{ leftoverBeats.includes(',') ? 'were' : 'was' }} planned again. These {{ leftovers.length }} were made for the shots before and no
      longer apply - the new plan has its own. Nothing to decide: clear them out.
    </p>
    <DisclosureBox class="planned" title="Show them" quiet small>
      <DirectionItem
        v-for="item in leftovers"
        :key="item.key"
        :item="item"
        as="leftover"
        :name="name"
        :blocked="blocked"
        @rebind="$emit('rebind', $event)"
        @clear="$emit('clear', $event)"
      />
    </DisclosureBox>
  </PanelCard>

  <PanelCard
    v-if="review.length"
    title="To decide"
    note="These select no shot of the plan as it is now: edit them for a shot that is there, or remove them."
    tone="stale"
  >
    <DirectionItem
      v-for="item in review"
      :key="item.key"
      :item="item"
      as="review"
      :name="name"
      :blocked="blocked"
      :dirty="dirty"
      :timeline="item.scope.kind === 'shot' ? timeline(item.scope.id) : undefined"
      @edit="$emit('edit', $event)"
      @remove="$emit('remove', $event)"
      @undo="$emit('undo', $event)"
    />
  </PanelCard>

  <p v-if="!items.length" class="muted dp-empty">No instructions or edits yet. Write one on the right, or direct a shot on the timeline.</p>
  <p v-else-if="!shown.length" class="muted dp-empty">Nothing matches the filter.</p>

  <PanelCard v-for="group in grouped" :key="group.key" :title="group.title" :note="group.label ? withNames(group.label) : undefined">
    <template v-for="block in [{id: '', items: group.general}, ...group.shots]" :key="block.id">
      <div :class="{'shot-block': block.id}">
        <h3 v-if="block.id">Shot {{ shotNumber(block.id) }} <RouterLink class="go" :to="timeline(block.id)">open in the timeline</RouterLink></h3>
        <DirectionItem
          v-for="item in activeOf(block.items)"
          :key="item.key"
          :item="item"
          as="active"
          :name="name"
          :blocked="blocked"
          :dirty="dirty"
          @edit="$emit('edit', $event)"
          @remove="$emit('remove', $event)"
          @undo="$emit('undo', $event)"
        />
        <DisclosureBox
          v-if="plannedOf(block.items).length"
          class="planned"
          :title="`Who is in the shot (${plannedOf(block.items).length}${block.id ? '' : ', kept when the shots are planned again'})`"
          quiet
          small
        >
          <DirectionItem
            v-for="item in plannedOf(block.items)"
            :key="item.key"
            :item="item"
            as="planned"
            :name="name"
            :blocked="blocked"
            @remove="$emit('remove', $event)"
          />
        </DisclosureBox>
      </div>
    </template>
  </PanelCard>
</template>

<style scoped>
.shot-block {
  border-top: 1px solid var(--line);
  padding-top: 6px;
  margin-top: 4px;
}
.shot-block h3 {
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
.planned {
  margin: 4px 0;
}
.dp-empty {
  padding: 8px 2px;
}
.small {
  font-size: var(--text-s);
}
.spacer {
  flex: 1;
}
</style>
