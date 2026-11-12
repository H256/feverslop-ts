<script setup lang="ts">
import {computed} from 'vue'
import type {LookElement} from '../../../../shared/workspace'
import {mediaUrl} from '../../api/urls'
import {useProject} from '../project/session'
import {LOOK_FIELDS, type LookEdits} from './lookEdits'

/**
 * How one character or place looks: its picture next to its texts, to change, or to have written anew. A library asset's texts are
 * the library's. Class names of their own (lk-): .member, .head and .field are styled for other pages in workspace.css.
 */
const props = defineProps<{element: LookElement; edits: LookEdits}>()
const {project, roots, root} = useProject()
const picture = computed(() => project.value.pictures.find(p => p.id === props.element.id && p.exists))
const changed = computed(() => props.edits.isChanged(props.element))
</script>

<template>
  <article :class="['lk-card', {changed}]">
    <header class="lk-head">
      <b>{{ element.name }}</b>
      <span
        v-if="element.library"
        class="lk-lib"
        title='Its texts are the library&apos;s: changed in the library, or by choosing "Rendered in this project" on Casting'
        >library: {{ element.library }}</span
      >
      <div class="spacer" />
      <label
        v-if="!element.library && element.look !== undefined"
        class="lk-again"
        title="The language model writes its look again, and what is written from it - for this one only"
      >
        <input type="checkbox" :checked="edits.isAgain(element)" @change="edits.setAgain(element, ($event.target as HTMLInputElement).checked)" /> Write anew
      </label>
    </header>
    <div class="lk-body">
      <RouterLink v-if="picture" class="lk-pic" :to="`${root}/references`" :title="`${element.name} on References`">
        <img :src="mediaUrl(picture, roots)" :alt="element.name" loading="lazy" />
      </RouterLink>
      <div class="lk-texts">
        <p v-if="element.look === undefined" class="muted">Not written yet - plan the look.</p>
        <template v-for="{field, label, rows} in LOOK_FIELDS" :key="field">
          <label v-if="element[field] !== undefined" class="lk-field">
            <span>{{ label }}</span>
            <textarea
              :rows="rows"
              :value="edits.valueOf(element, field)"
              :readonly="!!element.library"
              @input="edits.set(element, field, ($event.target as HTMLTextAreaElement).value)"
            />
          </label>
        </template>
      </div>
    </div>
  </article>
</template>

<style scoped>
.lk-card {
  min-width: 0;
  border: 1px solid var(--line);
  border-left: 3px solid var(--line);
  border-radius: var(--radius-m);
  padding: 10px 12px 12px;
  background: var(--surface);
}
.lk-card.changed {
  border-left-color: var(--accent);
}
.lk-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 8px;
}
.lk-head b {
  font-size: var(--text-l);
}
.lk-lib {
  font-size: var(--text-xs);
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
}
.lk-again {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-s);
  color: var(--muted);
  cursor: pointer;
}
.lk-body {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
}
.lk-body:not(:has(.lk-pic)) {
  grid-template-columns: minmax(0, 1fr);
}
.lk-pic img {
  width: 96px;
  aspect-ratio: 3 / 4;
  object-fit: contain;
  border-radius: var(--radius-m);
  display: block;
  background: var(--raised);
}
.lk-texts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.lk-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.lk-field span {
  font-size: var(--text-s);
  color: var(--muted);
}
.lk-field textarea {
  width: 100%;
  min-width: 0;
  font: var(--text-m)/1.5 var(--sans);
  resize: vertical;
}
@media (max-width: 560px) {
  .lk-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
