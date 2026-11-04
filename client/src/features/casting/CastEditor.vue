<script setup lang="ts">
import PageBar from '../../components/PageBar.vue'
import CastMemberForm from './CastMemberForm.vue'
import {newMember, type DraftMember} from './forms'

/**
 * The cast by hand, one list of the caller's draft: its members as forms, and - where the cast can grow - adding and removing them.
 * The list is changed in place; the page reads it when it saves.
 */
const props = defineProps<{members: DraftMember[], title: string, kind: 'character' | 'location', film: boolean, canAdd: boolean}>()
const add = () => props.members.push(newMember(props.kind))
const remove = (n: number) => props.members.splice(n, 1)
// a stable key for each form, new ones too: removing one does not move the typing of another
const keys = new WeakMap<object, number>()
let next = 0
const keyOf = (member: DraftMember) => keys.get(member) ?? keys.set(member, next++).get(member)!
</script>

<template>
  <div class="section">
    <PageBar :title="title"><button v-if="canAdd" class="btn" @click="add">{{ kind === 'character' ? 'Add a character' : 'Add a place' }}</button></PageBar>
    <div class="member-grid">
      <CastMemberForm v-for="(member, n) in members" :key="keyOf(member)" :draft="member" :kind="kind" :film="film" :removable="canAdd" @remove="remove(n)" />
    </div>
    <p v-if="!members.length" class="muted">{{ kind === 'character' ? 'Nobody yet.' : 'No place yet - a music video needs one.' }}</p>
  </div>
</template>
