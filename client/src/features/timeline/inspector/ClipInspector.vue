<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {clock} from '../../../lib/format'
import {STATE_CHIPS, stateOf} from '../clips'
import {useTimeline, type TimelineContext} from '../context'
import type {Tab} from '../useTimeline'
import PromptPanel from './PromptPanel.vue'
import RefsPanel from './RefsPanel.vue'
import RenderPanel from './RenderPanel.vue'
import ShotsPanel from './ShotsPanel.vue'
import VersionsPanel from './VersionsPanel.vue'

/** The clip at the playhead: what it is now, and its prompt, shots, references, rendering and versions - one tab at a time. */
const {project, fresh, playback, tab, versions} = useTimeline()
const clip = computed(() => playback.clip.value)
const state = computed(() => clip.value && STATE_CHIPS[stateOf(clip.value, fresh.value)])
const group = computed(() => clip.value && (project.value.groups.find(g => g.id === clip.value!.group)?.label ?? clip.value.group))
const TABS: {id: Tab; name: string; count: (ctx: TimelineContext['playback']['clip']['value']) => number | undefined}[] = [
  {id: 'prompt', name: 'Prompt', count: () => undefined},
  {id: 'shots', name: 'Shots', count: c => c?.shots.length},
  {id: 'refs', name: 'References', count: c => c && c.pictures.length + c.audio.length},
  {id: 'render', name: 'Render', count: () => undefined},
  {id: 'versions', name: 'Versions', count: c => (versions.value?.clip === c?.id ? versions.value?.list.length || undefined : undefined)},
]
const PANELS = {prompt: PromptPanel, shots: ShotsPanel, refs: RefsPanel, render: RenderPanel, versions: VersionsPanel}
const panel = ref<HTMLElement>()
const choose = (id: Tab) => {
  tab.value = id
  panel.value?.scrollTo({top: 0})
}
watch(clip, () => panel.value?.scrollTo({top: 0}))
</script>

<template>
  <aside class="inspector" aria-label="Clip">
    <div class="ihead">
      <template v-if="clip && state">
        <h2>
          {{ clip.id }}<span :class="state.cls" :title="state.title" class="u-sans">{{ state.label }}</span>
        </h2>
        <p class="num">{{ clock(clip.start) }} – {{ clock(clip.end) }} · {{ (clip.end - clip.start).toFixed(1) }}s · {{ group }}</p>
        <div v-for="mark in clip.marks" :key="mark.text" :class="['warn', {bad: mark.kind === 'failed' || mark.kind === 'backdrop'}]">{{ mark.text }}</div>
      </template>
      <template v-else
        ><h2>No clip</h2>
        <p>Nothing at the playhead</p></template
      >
    </div>
    <div class="tabs" role="tablist">
      <template v-if="clip">
        <button v-for="t in TABS" :key="t.id" role="tab" :aria-selected="tab === t.id" @click="choose(t.id)">
          {{ t.name }}<small v-if="t.count(clip)">{{ t.count(clip) }}</small>
        </button>
      </template>
    </div>
    <div ref="panel" class="panel" role="tabpanel">
      <component :is="PANELS[tab]" v-if="clip" :key="`${clip.id}:${tab}`" :clip="clip" />
      <div v-else-if="project.clips.length" class="empty">Pick a clip on the timeline.</div>
      <template v-else>
        <div class="section">
          <h3>The plan</h3>
        </div>
        <p class="muted">
          There are no clips yet. Plan it stage by stage, as a film is made: the story, then the cast, then the look, then the shots - each one looked at and
          changed before the next is built on it. All of it is the language model; nothing is rendered before you ask on this timeline.
        </p>
        <p class="muted">In the terminal: {{ project.command }} --until=story|cast|look</p>
      </template>
    </div>
  </aside>
</template>
