<script setup lang="ts">
import {RouterLink} from 'vue-router'
import type {LibrarySongEntry} from '../../../../shared/workspace'
import {LIBRARY_ROOTS, mediaUrl, projectRoot} from '../../api/urls'
import CopyCommand from '../../components/CopyCommand.vue'
import FactList from '../../components/FactList.vue'
import {clock} from '../../lib/format'
import LibraryActions from './LibraryActions.vue'

/** A song of the library (#835): listened to on a click, what is worked out of it, the music videos made of it. */
defineProps<{song: LibrarySongEntry}>()
defineEmits<{changed: []}>()
</script>

<template>
  <div>
    <h2>{{ song.name }}</h2>
    <p class="muted section">Song · {{ song.id }}</p>
    <!-- played only when asked: no autoplay -->
    <audio v-if="song.audio" class="sd-audio" controls preload="none" :src="mediaUrl(song.audio, LIBRARY_ROOTS)" />
    <LibraryActions kind="song" :id="song.id" :name="song.name" @changed="$emit('changed')" />
    <FactList
      :facts="[
        {name: 'Length', value: song.seconds ? clock(song.seconds, false) : undefined},
        {name: 'Stems', value: String(song.stems)},
        {name: 'Lines', value: `${song.lines}, ${song.byHand} placed by hand`},
        {name: 'Comes from', value: song.source},
      ]"
    />
    <div class="section">
      <h3>Music videos of it</h3>
      <div v-for="use in song.usedBy" :key="use.id"><RouterLink :to="projectRoot(use)">{{ use.id }}</RouterLink></div>
      <p v-if="!song.usedBy.length" class="muted">None yet. A project takes it with:</p>
      <CopyCommand :command="`bun run import-song <project-id> ${song.id}`" />
    </div>
  </div>
</template>

<style scoped>
.sd-audio {
  width: 100%;
  margin: 4px 0 8px;
}
</style>
