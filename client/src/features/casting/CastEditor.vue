<script setup lang="ts">
import PageBar from '../../components/PageBar.vue'
import CastMemberForm, {type DraftMember} from './CastMemberForm.vue'

/** The cast by hand, one list: its members as forms, and - where the cast can grow - adding and removing them. */
const props = defineProps<{title: string, kind: 'character' | 'location', film: boolean, canAdd: boolean}>()
const members = defineModel<DraftMember[]>({required: true})
const add = () => members.value.push(props.kind === 'character' ? {name: '', role: ''} : {name: ''})
const remove = (n: number) => members.value.splice(n, 1)
// a stable key for each form, new ones too: removing one does not move the typing of another
const keys = new WeakMap<object, number>()
let next = 0
const keyOf = (member: DraftMember) => keys.get(member) ?? keys.set(member, next++).get(member)!
</script>

<template>
  <div class="section">
    <PageBar :title="title"><button v-if="canAdd" class="btn" @click="add">{{ kind === 'character' ? 'Add a character' : 'Add a place' }}</button></PageBar>
    <CastMemberForm v-for="(member, n) in members" :key="keyOf(member)" v-model="members[n]!" :kind="kind" :film="film" :removable="canAdd" @remove="remove(n)" />
    <p v-if="!members.length" class="muted">{{ kind === 'character' ? 'Nobody yet.' : 'No place yet - a music video needs one.' }}</p>
  </div>
</template>
