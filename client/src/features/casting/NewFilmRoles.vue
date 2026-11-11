<script setup lang="ts">
import FormField from '../../components/FormField.vue'

/**
 * The roles a film gets with its screenplay told anew (#589): a name and who they are in the story - the language model gives them a
 * part, a look and a voice. The list is the caller's and changed in place; it is sent with the roles taken out on the list of roles.
 */
const props = defineProps<{roles: {name: string; role: string}[]}>()
const remove = (n: number) => props.roles.splice(n, 1)
// a stable key for each form: removing one does not move the typing of another
const keys = new WeakMap<object, number>()
let next = 0
const keyOf = (role: object) => keys.get(role) ?? keys.set(role, next++).get(role)!
</script>

<template>
  <div v-if="roles.length" class="member-grid" data-cast="new-film-role">
    <article v-for="(role, n) in roles" :key="keyOf(role)" class="member">
      <div class="head">
        <b>new</b>
        <div class="spacer" />
        <button class="btn danger" title="Not added after all" @click="remove(n)">Remove</button>
      </div>
      <FormField label="Name"><input v-model="role.name" type="text" aria-label="Name" maxlength="80" /></FormField>
      <FormField label="Role in the story">
        <textarea
          v-model="role.role"
          rows="2"
          aria-label="Role in the story"
          maxlength="600"
          placeholder="Who they are and what they do in the story - the screenplay is told anew with them"
        />
      </FormField>
    </article>
  </div>
</template>
