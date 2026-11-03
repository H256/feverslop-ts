<script setup lang="ts">
import {computed} from 'vue'

/** Pages of a long list: the first, the last and those around this one - a long list does not need every number. */
const props = defineProps<{page: number, pages: number, first: number, shown: number, total: number}>()
const emit = defineEmits<{go: [page: number]}>()
const numbers = computed(() => [...new Set([1, props.page - 1, props.page, props.page + 1, props.pages])].filter(n => n >= 1 && n <= props.pages).sort((a, b) => a - b))
</script>

<template>
  <nav v-if="pages > 1" class="pager" aria-label="Pages">
    <button class="btn" :disabled="page === 1" @click="emit('go', page - 1)">‹ Newer</button>
    <template v-for="(n, i) in numbers" :key="n">
      <span v-if="i && n - numbers[i - 1]! > 1" class="muted">…</span>
      <button class="btn" :aria-current="n === page ? 'page' : undefined" @click="emit('go', n)">{{ n }}</button>
    </template>
    <button class="btn" :disabled="page === pages" @click="emit('go', page + 1)">Older ›</button>
    <span class="muted num">{{ first + 1 }}-{{ first + shown }} of {{ total }}</span>
  </nav>
</template>
