<script setup lang="ts">
import {computed} from 'vue'
import type {SingingLine} from '../../../../shared/workspace'
import AppIcon from '../../components/AppIcon.vue'
import {clock, plural} from '../../lib/format'
import {describe, partsOfView, partText, spanOf} from './parts'
import SingerChip from './SingerChip.vue'
import type {SingingDraft} from './useSingingDraft'

/**
 * A line of the song and who sings it: its words, a place to click between two of them where the singer changes, one row of singers
 * per part. Keys: a digit toggles a singer, ← → the part, Space listens; ↑ ↓ go to the line before or after (the page's).
 */
const props = defineProps<{line: SingingLine, draft: SingingDraft, playing?: string, canListen: boolean}>()
const emit = defineEmits<{listen: [key: string, start?: number, end?: number], move: [by: number]}>()
const parts = computed(() => props.draft.partsOf(props.line))
const changed = computed(() => props.draft.isChanged(props.line))
const nobody = computed(() => parts.value.some(p => !p.singers.size))
const where = computed(() => props.line.beats.length ? `${props.line.beats.join(', ')} · ${plural(props.line.clips.length, 'clip')}` : 'in no clip of the plan')
const note = computed(() => [changed.value && `was ${describe(partsOfView(props.line), props.draft.nameOf)}`, where.value].filter(Boolean).join(' · '))
const partAt = (n: number) => parts.value.findLastIndex(p => p.from <= n)
const firstSinger = (n: number) => [...parts.value[partAt(n)]!.singers][0]
const isSplit = (n: number) => parts.value.some(p => p.from === n)
const playable = computed(() => props.canListen && props.line.start !== undefined)
const listenPart = (k: number) => {
  const {start, end} = spanOf(props.line, parts.value, k)
  emit('listen', `${props.line.line}:${k}`, start, end)
}
const listenLine = () => emit('listen', String(props.line.line), props.line.start, props.line.end)

function key(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const digit = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1
  const singer = props.draft.pool.value[digit]
  if (singer) props.draft.toggle(props.line, singer)
  else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && parts.value.length > 1) props.draft.movePart(props.line, event.key === 'ArrowRight' ? 1 : -1)
  else if (event.key === 'ArrowDown' || event.key === 'j') emit('move', 1)
  else if (event.key === 'ArrowUp' || event.key === 'k') emit('move', -1)
  else if (event.key === ' ') parts.value.length > 1 ? listenPart(props.draft.activeOf(props.line)) : listenLine()
  else return
  event.preventDefault()
}
</script>

<template>
  <div :id="`line-${line.line}`" :class="['sung', {changed, empty: nobody, 'has-parts': parts.length > 1}]" tabindex="0" :data-line="line.line" @keydown="key">
    <button :class="['tbtn listen', {on: playing === String(line.line)}]" tabindex="-1" :disabled="!playable" :title="canListen ? 'Listen to the line (Space)' : 'No vocals stem or song to listen to'" aria-label="Listen" @click="listenLine"><AppIcon name="play" /></button>
    <time>{{ line.start !== undefined ? clock(line.start) : '' }}</time>
    <div class="text">
      <div class="words" :title="line.words.length > 1 ? 'Click between two words: the singer changes there' : ''">
        <template v-if="line.words.length < 2">{{ line.text }}</template>
        <template v-for="(word, n) in line.words" v-else :key="n">
          <button v-if="n" :class="['gap', {split: isSplit(n)}]" tabindex="-1"
            :title="isSplit(n) ? 'Take this change of singer back' : `The singer changes here: from &quot;${word.text}&quot; on`"
            :aria-label="isSplit(n) ? `Take the change before &quot;${word.text}&quot; back` : `Change the singer before &quot;${word.text}&quot;`"
            @click.stop="draft.split(line, n)" />
          <span class="word" :style="firstSinger(n) ? {'--h': draft.hueOf(firstSinger(n)!)} : {}">{{ word.text }}</span>
        </template>
      </div>
      <small v-if="nobody" class="bad">{{ parts.length > 1 ? 'A part of this line has no singer' : 'Nobody sings this line' }}</small>
      <small v-else>{{ note }}</small>
      <small v-if="parts.length > 1 && line.estimated" class="estimated">The times of these words are only estimated: the change can sit off - listen to the parts</small>
    </div>
    <div v-if="parts.length < 2" class="who">
      <SingerChip v-for="(id, n) in draft.pool.value" :key="id" :name="draft.nameOf(id)" :number="n + 1" :hue="draft.hueOf(id)" :pressed="parts[0]!.singers.has(id)" :title="`${draft.nameOf(id)} sings this line (${n + 1})`" @toggle="draft.toggle(line, id, 0)" />
    </div>
    <div v-else class="parts">
      <div v-for="(part, k) in parts" :key="part.from" :class="['part', {active: k === draft.activeOf(line), empty: !part.singers.size}]">
        <button :class="['tbtn listen small', {on: playing === `${line.line}:${k}`}]" tabindex="-1" :disabled="!playable" title="Listen to this part" aria-label="Listen to this part" @click="listenPart(k)"><AppIcon name="play" /></button>
        <span class="from" :title="partText(line, parts, k)">{{ partText(line, parts, k) }}</span>
        <div class="who">
          <SingerChip v-for="(id, n) in draft.pool.value" :key="id" :name="draft.nameOf(id)" :number="n + 1" :hue="draft.hueOf(id)" :pressed="part.singers.has(id)" :title="`${draft.nameOf(id)} sings &quot;${partText(line, parts, k)}&quot; (${n + 1})`" @toggle="draft.toggle(line, id, k)" />
        </div>
      </div>
    </div>
  </div>
</template>
