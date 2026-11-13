<script setup lang="ts">
import type {CastingProp} from '../../../../shared/workspace'
import MediaThumb from '../../components/MediaThumb.vue'
import {plural} from '../../lib/format'
import {useViewer} from '../../services/viewer'
import {useProject} from '../project/session'

/** A character's prop with a picture of its own (#944), as a card like a role's: its picture, whose it is, and one from the library to take. */
defineProps<{prop: CastingProp; library: boolean}>()
const emit = defineEmits<{take: []}>()
const {roots} = useProject()
const viewer = useViewer()
</script>

<template>
  <article class="role">
    <MediaThumb
      :media="prop.picture"
      :roots="roots"
      cls=""
      :style="prop.picture ? {cursor: 'zoom-in'} : undefined"
      @click="prop.picture && viewer.open(prop.picture, roots, prop.name, prop.id)"
    />
    <div class="player">
      <div>
        <b>{{ prop.name }}</b> <span class="muted">{{ prop.id }}</span>
      </div>
      <div class="muted">of {{ prop.characterName }}{{ prop.libraryId ? ` · library: ${prop.libraryId}` : '' }}</div>
      <div class="muted about" :title="prop.description">{{ prop.description }}</div>
      <div class="muted">{{ prop.picture ? plural(prop.clips.length, 'clip') : 'no picture yet - rendered with the cast and the places' }}</div>
    </div>
    <div class="choice">
      <button
        class="btn"
        :disabled="!library"
        :aria-label="`A prop of the library for ${prop.characterName}`"
        :title="
          library
            ? `${prop.characterName}'s prop becomes one of the library - its name, description and picture: bun run import-asset … prop <id> --for=${prop.character}`
            : 'The library has no props yet - bun run export-asset puts one in'
        "
        @click="emit('take')"
      >
        From the library…
      </button>
    </div>
  </article>
</template>
