<script setup lang="ts">
import {computed} from 'vue'
import type {SingingView} from '../../../../shared/workspace'
import MediaThumb from '../../components/MediaThumb.vue'
import PlanChanges from '../../components/PlanChanges.vue'
import {plural} from '../../lib/format'
import {useViewer} from '../../services/viewer'
import {useProject} from '../project/session'
import type {SingingDraft} from './useSingingDraft'

/** The singers of the song in their colours, adding one from the cast, and what saving the changed lines does. */
const props = defineProps<{view: SingingView; draft: SingingDraft; saved?: string}>()
defineEmits<{save: [plan: boolean]; plan: []}>()
const {roots, busy} = useProject()
const viewer = useViewer()
const c = computed(() => props.draft.changes.value)
const characterOf = (id: string) => props.view.characters.find(ch => ch.id === id)
const others = computed(() => props.view.characters.filter(ch => !props.draft.pool.value.includes(ch.id)))
const clipsOf = (id: string) => plural(characterOf(id)?.clips.length ?? 0, 'clip')
const blocked = computed(() => (c.value.empty.length ? `${plural(c.value.empty.length, 'line')} without a singer` : busy.value ? 'A run is going on' : ''))
const effects = computed(() => {
  const {replanned, newSingers, formerSingers, clips, added, unplaced} = c.value
  const nameOf = props.draft.nameOf
  return [
    replanned.length &&
      `${replanned.join(', ')} ${replanned.length > 1 ? 'lose their' : 'loses its'} shot plan and ${replanned.length > 1 ? 'are' : 'is'} planned again: the language model, no GPU`,
    ...newSingers.map(
      id =>
        `${nameOf(id)} becomes a singer of the song: in all ${clipsOf(id)} with ${nameOf(id)} the prompt changes (a singer who is not singing keeps the mouth closed)`,
    ),
    ...formerSingers.map(id => `${nameOf(id)} no longer sings: the prompts of all ${clipsOf(id)} with ${nameOf(id)} change`),
    clips.length && `${plural(clips.length, 'clip')} go stale${clips.length <= 8 ? `: ${clips.join(', ')}` : ''}. Nothing is rendered on its own.`,
    ...added.map(({beat, id}) => `${nameOf(id)} is not in ${beat} yet: added to it - ${beat} is then staged without its floor plan`),
    unplaced.length && `${plural(unplaced.length, 'line')} in no clip: only the assignment changes`,
  ].filter((line): line is string => !!line)
})
const add = (event: Event) => {
  const select = event.target as HTMLSelectElement
  props.draft.addSinger(select.value)
  select.value = ''
}
</script>

<template>
  <div>
    <h2>Singers</h2>
    <p class="muted u-mb-2">The lead first. A line can be sung by several at once (a duet, a chorus), or change its singer between two words.</p>
    <div v-for="(id, n) in draft.pool.value" :key="id" class="singer" :style="{'--h': draft.hueOf(id)}">
      <MediaThumb
        :media="characterOf(id)?.picture"
        :roots="roots"
        cls=""
        :style="characterOf(id)?.picture ? {cursor: 'zoom-in'} : undefined"
        @click="characterOf(id)?.picture && viewer.open(characterOf(id)!.picture!, roots, draft.nameOf(id), id)"
      />
      <div>
        <b>{{ draft.nameOf(id) }}</b> <kbd>{{ n + 1 }}</kbd>
        <div class="muted num">{{ plural(draft.lineCount(id), 'line') }}</div>
        <div v-if="characterOf(id)?.role" class="muted about" :title="characterOf(id)?.role">{{ characterOf(id)?.role }}</div>
        <div v-if="!draft.lineCount(id)" class="muted u-small">
          {{ view.singers.includes(id) ? 'Sings nothing now: no longer a singer once saved.' : 'Not saved: give them a line.' }}
        </div>
      </div>
    </div>
    <select v-if="others.length" aria-label="Add a singer" class="u-wide" @change="add">
      <option value="">Add a singer from the cast…</option>
      <option v-for="ch in others" :key="ch.id" :value="ch.id">{{ ch.role ? `${ch.name} - ${ch.role}` : ch.name }}</option>
    </select>
    <PlanChanges
      :count="c.lines.length ? `${plural(c.lines.length, 'line')} changed` : ''"
      :effects="effects"
      :blocked="blocked"
      :saved="saved"
      :unplanned="view.unplanned"
      :busy="busy"
      idle="Change who sings a line, and the shots of its beat are planned again - only that beat, on its floor plan. Nothing is rendered."
      kept-in='Kept in project.json until lyrics.txt or "singers" in config.json change, or --redo=singing asks the language model again.'
      @discard="draft.reset()"
      @save="$emit('save', false)"
      @save-and-plan="$emit('save', true)"
      @plan="$emit('plan')"
    >
      <template #warning>
        <div v-if="c.empty.length" class="warn bad">
          Every line and part needs a singer:
          {{
            c.empty
              .map(l => `"${l.text}"`)
              .slice(0, 3)
              .join(', ')
          }}{{ c.empty.length > 3 ? ' …' : '' }}
        </div>
      </template>
    </PlanChanges>
  </div>
</template>
