<script setup lang="ts">
import FormField from '../../components/FormField.vue'

export type BeatCastDraft = {characters: string[]; join: {name: string; role: string}[]; without: string[]; note: string}

/**
 * Who is in the marked clips (#765, #767): people of the cast, new ones joining it, who goes out of them, and what they do there.
 * `inAll`: in every beat of the clips already - checked again, the planner is told they are in exactly these clips. `inSome`: in
 * at least one of them - only they can go out.
 */
const props = defineProps<{draft: BeatCastDraft; cast: {id: string; name: string; role?: string}[]; inAll: string[]; inSome: string[]}>()
const addRow = () => props.draft.join.push({name: '', role: ''})
const dropRow = (n: number) => props.draft.join.splice(n, 1)
</script>

<template>
  <div class="beat-cast">
    <FormField v-if="cast.length" label="In these clips">
      <div class="who">
        <label v-for="c in cast" :key="c.id" :title="c.role">
          <input v-model="draft.characters" type="checkbox" :value="c.id" :disabled="draft.without.includes(c.id)" />
          {{ c.name }}<span v-if="inAll.includes(c.id)" class="muted"> - in these beats already</span>
        </label>
      </div>
    </FormField>
    <FormField label="New people - each one their own person, with a picture of their own">
      <div v-for="(row, n) in draft.join" :key="n" class="row">
        <input v-model="row.name" type="text" placeholder="Name, e.g. Mara" maxlength="80" />
        <input
          v-model="row.role"
          type="text"
          placeholder="Who she is and what she looks like: a dancer in her twenties, long black hair, a dark red velvet dress"
        />
        <button type="button" class="btn" title="Leave this one out" @click="dropRow(n)">×</button>
      </div>
      <button type="button" class="btn" @click="addRow">Another person</button>
    </FormField>
    <FormField v-if="inSome.length" label="Not in these clips - taken out, whatever the beat's story says">
      <div class="who">
        <label v-for="c in cast.filter(c => inSome.includes(c.id))" :key="c.id">
          <input v-model="draft.without" type="checkbox" :value="c.id" :disabled="draft.characters.includes(c.id)" />
          {{ c.name }}
        </label>
      </div>
    </FormField>
    <FormField label="What they do there - a direction rule on these clips, the planner keeps to it">
      <textarea
        v-model="draft.note"
        rows="4"
        maxlength="2000"
        placeholder="Mara and Lene dance a slow, stately waltz in the candlelit room behind Elias, never touching him; he sings at the front."
      />
    </FormField>
  </div>
</template>

<style scoped>
.who {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.who label {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  white-space: nowrap;
}
.who input {
  width: auto;
  margin: 0;
}
.row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) auto;
  gap: 6px;
  margin-bottom: 6px;
}
textarea {
  width: 100%;
}
</style>
