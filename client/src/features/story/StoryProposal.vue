<script setup lang="ts">
/** A story told anew for the cast, next to the story there is: to be taken or dropped. */
defineProps<{now: string, proposal: string}>()
defineEmits<{take: [], drop: []}>()
</script>

<template>
  <div class="section">
    <div class="note">A story told anew for the cast as it is now. Take it, or drop it and keep the story there is.</div>
    <div class="twocol">
      <div><h3>Now</h3><div class="text">{{ now }}</div></div>
      <div><h3>Told anew for the cast</h3><div class="text">{{ proposal }}</div></div>
    </div>
    <div class="btn-row" style="margin-top: 8px">
      <button class="btn primary" @click="$emit('take')">Take the new story</button>
      <button class="btn" @click="$emit('drop')">Drop it</button>
    </div>
  </div>
</template>
