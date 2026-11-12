<script setup lang="ts">
import {computed} from 'vue'

/** A story told anew for the cast, next to the story there is: to be taken or dropped. A film: its screenplay told anew for a role that came or went. */
const props = defineProps<{now: string; proposal: string; film?: boolean; cast?: {added: string[]; removed: string[]}}>()
defineEmits<{take: []; drop: []}>()
const what = computed(() => (props.film ? 'screenplay' : 'story'))
const change = computed(() =>
  [props.cast?.added.length && `new: ${props.cast.added.join(', ')}`, props.cast?.removed.length && `gone: ${props.cast.removed.join(', ')}`]
    .filter(Boolean)
    .join(' · '),
)
</script>

<template>
  <div class="section">
    <div class="note">
      A {{ what }} told anew for the cast as it is now{{ change ? ` (${change})` : '' }}. Take it, or drop it and keep the {{ what }} there is.
    </div>
    <div class="twocol">
      <div>
        <h3>Now</h3>
        <div class="text">{{ now }}</div>
      </div>
      <div>
        <h3>Told anew for the cast</h3>
        <div class="text">{{ proposal }}</div>
      </div>
    </div>
    <div class="btn-row u-mt-2">
      <button class="btn primary" @click="$emit('take')">Take the new {{ what }}</button>
      <button class="btn" @click="$emit('drop')">Drop it</button>
    </div>
  </div>
</template>
