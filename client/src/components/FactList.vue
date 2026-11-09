<script setup lang="ts">
import {computed} from 'vue'

/** Name and value, one per row; a row without a value is left out. A value can be drawn by the caller through the #value slot. */
export type Fact = {name: string; value?: string; key?: string}
const props = defineProps<{facts: Fact[]}>()
const shown = computed(() => props.facts.filter(fact => fact.value !== undefined && fact.value !== ''))
</script>

<template>
  <dl class="facts">
    <template v-for="fact in shown" :key="fact.key ?? fact.name">
      <dt>{{ fact.name }}</dt>
      <dd>
        <slot name="value" :fact="fact">{{ fact.value }}</slot>
      </dd>
    </template>
  </dl>
</template>
