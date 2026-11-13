<script setup lang="ts">
import {computed, ref} from 'vue'
import type {LibrarySongEntry} from '../../../../shared/workspace'
import {workspace} from '../../api/workspace'
import FormField from '../../components/FormField.vue'
import {errorText} from '../../lib/format'
import {idProblem, LANGUAGES, languageLabel, suggestedId, type NewProjectDraft} from './newProject'

/**
 * What a new music video is made from, filled into the caller's draft: the options of `bun run init` (#831). A song of the library
 * (#835) comes with its lyrics, stems and timing. #939: a name the id is suggested from, a song chosen as a file and sent, who
 * sings and the language as choices - each still what the command takes.
 */
const props = defineProps<{draft: NewProjectDraft; songs: LibrarySongEntry[]; taken: readonly string[]}>()

// the id follows the name until it is changed by hand
const setName = (name: string) => {
  props.draft.name = name
  if (!props.draft.idChanged) props.draft.id = suggestedId(name)
}
const setId = (id: string) => {
  props.draft.id = id
  props.draft.idChanged = id.trim() !== '' && id !== suggestedId(props.draft.name)
}
const idSaid = computed(() => idProblem(props.draft.id, props.taken))

// a song chosen: sent at once, the path the server put it at goes into the draft - never the browser's "fakepath"
const sending = ref(false)
const sendError = ref('')
const fileInput = ref<HTMLInputElement>()
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const chosen = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  sending.value = true
  sendError.value = ''
  try {
    const form = new FormData()
    form.set('song', file)
    const sent = await workspace.uploadSong(form)
    props.draft.song = sent.file
    props.draft.sent = {name: sent.name || file.name, bytes: sent.bytes}
  } catch (cause) {
    sendError.value = errorText(cause)
  } finally {
    sending.value = false
  }
}
const typePath = () => {
  props.draft.sent = undefined
  props.draft.song = ''
}
const language = computed(() => languageLabel(props.draft.language))
</script>

<template>
  <div class="np-form">
    <div class="np-pair">
      <FormField label="Name"><input :value="draft.name" type="text" placeholder="Well of Youth" @input="setName(($event.target as HTMLInputElement).value)" /></FormField>
      <FormField label="Project id - the folder's name" :note="idSaid" :class="{'np-wrong': idSaid}">
        <input
          :value="draft.id"
          type="text"
          placeholder="well-of-youth"
          required
          :aria-invalid="!!idSaid"
          @input="setId(($event.target as HTMLInputElement).value)"
        />
      </FormField>
    </div>
    <div class="np-seg" role="group" aria-label="The song">
      <button type="button" :aria-pressed="draft.from === 'song'" @click="draft.from = 'song'">A song I have</button>
      <button v-if="songs.length" type="button" :aria-pressed="draft.from === 'library'" @click="draft.from = 'library'">A song of the library</button>
      <button type="button" :aria-pressed="draft.from === 'idea'" @click="draft.from = 'idea'">A song to be made</button>
    </div>
    <template v-if="draft.from === 'song'">
      <div class="np-song">
        <span class="np-label">The song (.wav, .mp3, .flac)</span>
        <div v-if="draft.sent" class="np-sent" role="status">
          <span
            >{{ draft.sent.name }} <span class="muted">· {{ megabytes(draft.sent.bytes) }} · sent, copied into the project as it is created</span></span
          >
          <button type="button" class="btn mini" @click="fileInput?.click()">Another file…</button>
          <button type="button" class="btn mini" @click="typePath">Type a path instead</button>
        </div>
        <template v-else>
          <div class="np-choose">
            <button type="button" class="btn" :disabled="sending" @click="fileInput?.click()">{{ sending ? 'Sending…' : 'Choose a file…' }}</button>
            <span class="muted">or where it is on this machine:</span>
          </div>
          <input v-model="draft.song" type="text" aria-label="Song file on this machine" placeholder="D:\music\my-song.mp3" />
        </template>
        <input ref="fileInput" class="np-file" type="file" accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac" aria-label="Choose the song file" @change="chosen" />
        <p v-if="sendError" class="np-error" role="alert">{{ sendError }}</p>
      </div>
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
      <fieldset class="np-singers">
        <legend>Who sings on screen</legend>
        <label><input v-model="draft.singersMode" type="radio" value="nobody" /> Nobody</label>
        <label><input v-model="draft.singersMode" type="radio" value="auto" /> Chosen from the song by the plan</label>
        <label><input v-model="draft.singersMode" type="radio" value="names" /> These people:</label>
        <input v-if="draft.singersMode === 'names'" v-model="draft.singers" type="text" aria-label="Who sings, by name" placeholder="Lira, Kael" />
      </fieldset>
      <FormField label="Language of the lyrics" :note="draft.language.trim() ? (language ?? 'no language code like en or de') : 'en if empty'">
        <input v-model="draft.language" type="text" list="np-languages" placeholder="en" :aria-invalid="!!draft.language.trim() && !language" />
        <datalist id="np-languages">
          <option v-for="code in LANGUAGES" :key="code" :value="code">{{ languageLabel(code) }}</option>
        </datalist>
      </FormField>
    </div>
    <p class="muted np-note">
      The same as <code>bun run init &lt;id&gt; --song=… --lyrics=…</code> (or <code>--library-song=…</code>, <code>--idea=…</code>). The render settings start at their defaults
      and are changed on the Settings page. Nothing is planned or rendered by creating it.
    </p>
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
.np-song {
  display: grid;
  gap: var(--space-1);
}
/* as the label of a FormField: muted and small */
.np-label,
.np-singers legend {
  color: var(--muted);
  font-size: var(--text-s);
}
.np-choose,
.np-sent {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
/* the browser's own file field stays hidden: its button says "Choose a file…" in the words of the form */
.np-file {
  display: none;
}
.np-error,
.np-wrong :deep(.field-note) {
  color: var(--danger);
}
.np-error {
  margin: 0;
  font-size: var(--text-s);
}
.np-singers {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.np-singers label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-s);
}
</style>
