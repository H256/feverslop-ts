<script setup lang="ts">
import type {LibrarySongEntry} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'
import type {NewProjectDraft} from './newProject'

/** What a new music video is made from, filled into the caller's draft: the options of `bun run init` (#831). A song of the library (#835) comes with its lyrics, stems and timing. */
defineProps<{draft: NewProjectDraft; songs: LibrarySongEntry[]}>()
</script>

<template>
  <div class="np-form">
    <FormField label="Project id"><input v-model="draft.id" type="text" placeholder="well-of-youth" required /></FormField>
    <div class="np-seg" role="group" aria-label="The song">
      <button type="button" :aria-pressed="draft.from === 'song'" @click="draft.from = 'song'">A song I have</button>
      <button v-if="songs.length" type="button" :aria-pressed="draft.from === 'library'" @click="draft.from = 'library'">A song of the library</button>
      <button type="button" :aria-pressed="draft.from === 'idea'" @click="draft.from = 'idea'">A song to be made</button>
    </div>
    <template v-if="draft.from === 'song'">
      <FormField label="Song file on this machine (.wav, .mp3, .flac)"><input v-model="draft.song" type="text" placeholder="D:\music\my-song.mp3" /></FormField>
      <FormField label="Lyrics"><textarea v-model="draft.lyrics" rows="6" placeholder="Verse 1&#10;…" /></FormField>
    </template>
    <template v-else-if="draft.from === 'library'">
      <FormField label="The song - its lyrics, stems and timing come with it; the plan starts at the story">
        <select v-model="draft.librarySong" aria-label="The song of the library">
          <option value="" disabled>Choose a song</option>
          <option v-for="song in songs" :key="song.id" :value="song.id">{{ song.name }}{{ song.seconds ? ` · ${Math.round(song.seconds)} s` : '' }}</option>
        </select>
      </FormField>
    </template>
    <template v-else>
      <FormField label="Song idea"><textarea v-model="draft.idea" rows="3" placeholder="What the song is about, its mood, its genre" /></FormField>
      <FormField label="Lyrics of your own (optional - else they are written from the idea)"><textarea v-model="draft.lyrics" rows="4" /></FormField>
    </template>
    <FormField label="Story idea (optional)"><textarea v-model="draft.storyIdea" rows="2" placeholder="What the video shows" /></FormField>
    <FormField label="Visual style (optional - picked from the examples if empty)"><textarea v-model="draft.style" rows="2" /></FormField>
    <div class="np-pair">
      <FormField label="Who sings on screen"><input v-model="draft.singers" type="text" placeholder="auto, or names - empty: nobody" /></FormField>
      <FormField label="Language of the lyrics"><input v-model="draft.language" type="text" placeholder="en" /></FormField>
    </div>
    <p class="muted np-note">
      The same as <code>bun run init &lt;id&gt; --song=… --lyrics=…</code> (or <code>--library-song=…</code>, <code>--idea=…</code>). The render settings start at their defaults and are changed on the Settings page.</p>
  </div>
</template>

<style scoped>
.np-form {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.np-seg {
  display: flex;
  gap: var(--space-2);
}
.np-seg button {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--surface);
}
.np-seg button[aria-pressed='true'] {
  background: var(--raised);
  border-color: var(--text);
}
.np-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.np-note {
  font-size: var(--text-s);
}
</style>
