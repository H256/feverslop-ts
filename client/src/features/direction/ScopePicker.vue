<script setup lang="ts">
import type {DirectionScope, DirectionView} from '../../../../shared/direction'

/**
 * What an instruction or a direct edit applies to (#839): its kind, and the character, beat (scene), shot or stretch of the song.
 * One picker for both forms of the Direction page.
 */
defineProps<{
  label: string
  /** the kinds this form offers, with their words */
  options: {value: DirectionScope['kind']; label: string}[]
  characterLabel: string
  view: Pick<DirectionView, 'characters' | 'groups' | 'shots'>
  film: boolean
}>()
const kind = defineModel<DirectionScope['kind']>('kind', {required: true})
const id = defineModel<string>('id', {required: true})
const from = defineModel<number>('from', {required: true})
const to = defineModel<number>('to', {required: true})
</script>

<template>
  <label
    >{{ label
    }}<select v-model="kind" @change="id = ''">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select></label
  >
  <label v-if="kind === 'character'"
    >{{ characterLabel
    }}<select v-model="id">
      <option value="" disabled>Choose character</option>
      <option v-for="c in view.characters" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select></label
  >
  <label v-if="kind === 'beat' || kind === 'scene'"
    >{{ film ? 'Scene' : 'Beat'
    }}<select v-model="id">
      <option value="" disabled>Choose {{ film ? 'scene' : 'beat' }}</option>
      <option v-for="g in view.groups" :key="g.id" :value="g.id">{{ g.id }} · {{ g.label }}</option>
    </select></label
  >
  <label v-if="kind === 'shot'"
    >Shot<select v-model="id">
      <option value="" disabled>Choose shot</option>
      <option v-for="shot in view.shots" :key="shot.id" :value="shot.id">{{ shot.id }} · {{ shot.data.action }}</option>
    </select></label
  >
  <div v-if="kind === 'time'" class="dp-pair">
    <label>From (s)<input v-model.number="from" type="number" min="0" step="0.1" /></label>
    <label>To (s)<input v-model.number="to" type="number" min="0" step="0.1" /></label>
  </div>
</template>
