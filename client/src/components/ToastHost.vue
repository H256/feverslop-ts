<script setup lang="ts">
import {useToasts} from '../services/toasts'

const {current} = useToasts()
</script>

<template>
  <div v-if="current" :key="current.id" :class="['toast', {bad: current.bad}]" role="status">{{ current.text }}</div>
</template>
