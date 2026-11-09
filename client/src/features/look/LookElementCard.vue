<script setup lang="ts">
import type {LookElement} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'
import {LOOK_FIELDS, type LookEdits} from './lookEdits'

/** How one character or place looks: its texts to change, or to have written anew. A library asset's texts are the library's. */
defineProps<{element: LookElement; edits: LookEdits}>()
</script>

<template>
  <article class="member">
    <div class="head">
      <b>{{ element.name }}</b
      ><span class="muted">{{ element.id }}</span>
      <span
        v-if="element.library"
        class="chip"
        title='Its texts are the library&apos;s: changed in the library, or by choosing "Rendered in this project" on Casting'
        >library:{{ element.library }}</span
      >
      <div class="spacer" />
      <label
        v-if="!element.library && element.look !== undefined"
        title="The language model writes its look again, and what is written from it - for this one only"
      >
        <input type="checkbox" :checked="edits.isAgain(element)" @change="edits.setAgain(element, ($event.target as HTMLInputElement).checked)" /> Write anew
      </label>
    </div>
    <p v-if="element.look === undefined" class="muted">Not written yet - plan the look.</p>
    <template v-for="{field, label, rows} in LOOK_FIELDS" :key="field">
      <FormField v-if="element[field] !== undefined" :label="label">
        <textarea
          :rows="rows"
          :value="edits.valueOf(element, field)"
          :readonly="!!element.library"
          @input="edits.set(element, field, ($event.target as HTMLTextAreaElement).value)"
        />
      </FormField>
    </template>
  </article>
</template>
