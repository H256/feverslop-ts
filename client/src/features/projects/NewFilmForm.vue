<script setup lang="ts">
import FormField from '../../components/FormField.vue'
import type {NewFilmDraft} from './newFilm'

/** What a new film is made from, filled into the caller's draft: the options of `bun run film:init` (#831). */
defineProps<{draft: NewFilmDraft}>()
</script>

<template>
  <div class="nf-form">
    <FormField label="Film id"><input v-model="draft.id" type="text" placeholder="the-last-lighthouse" required /></FormField>
    <div class="nf-seg" role="group" aria-label="What the film starts from">
      <button type="button" :aria-pressed="draft.from === 'idea'" @click="draft.from = 'idea'">A story idea</button>
      <button type="button" :aria-pressed="draft.from === 'screenplay'" @click="draft.from = 'screenplay'">A screenplay</button>
    </div>
    <FormField
      :label="
        draft.from === 'idea'
          ? 'Story idea, in any language - the characters, scenes and dialogue are written from it'
          : 'Screenplay, in any language - or the path of its file; adopted as it is'
      "
      ><textarea v-model="draft.text" rows="6"
    /></FormField>
    <FormField label="Visual style (optional)"><textarea v-model="draft.style" rows="2" /></FormField>
    <div class="nf-pair">
      <FormField :label="draft.from === 'idea' ? 'Length in seconds (empty: the default)' : 'Plan it to a length (empty: as the screenplay needs)'"
        ><input v-model="draft.length" type="text" inputmode="numeric" placeholder="90"
      /></FormField>
      <FormField v-if="draft.from === 'idea'" label="Dialogue language"><input v-model="draft.language" type="text" placeholder="en, or auto" /></FormField>
    </div>
    <p class="muted nf-note">The same as <code>bun run film:init &lt;id&gt; --idea=… | --screenplay=…</code>.</p>
  </div>
</template>

<style scoped>
.nf-form {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.nf-seg {
  display: flex;
  gap: var(--space-2);
}
.nf-seg button {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  background: var(--surface);
}
.nf-seg button[aria-pressed='true'] {
  background: var(--raised);
  border-color: var(--text);
}
.nf-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.nf-note {
  font-size: var(--text-s);
}
</style>
