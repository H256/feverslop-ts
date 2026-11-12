<script setup lang="ts">
import {computed} from 'vue'
import type {AssetSource} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'

/**
 * Which finished character or place of another music video a role takes over (#835) - `bun run import-asset` - and the
 * description that goes with its picture. Filled into the caller's draft; the question around it starts the command.
 */
const props = defineProps<{
  draft: {choice: string; description: 'source' | 'vision' | 'keep'}
  sources: AssetSource[]
  role: {id: string; name: string}
}>()
const chosen = computed(() => {
  const [project, asset] = props.draft.choice.split('/')
  return props.sources.find(s => s.project === project)?.assets.find(a => a.id === asset)
})
</script>

<template>
  <div class="ta-form">
    <FormField label="Take over">
      <select v-model="draft.choice" :aria-label="`What ${role.name} takes over`">
        <option value="" disabled>Choose one</option>
        <optgroup v-for="source in sources" :key="source.project" :label="source.project">
          <option v-for="asset in source.assets" :key="asset.id" :value="`${source.project}/${asset.id}`">
            {{ asset.name }}{{ asset.id === role.id || asset.name === role.name ? ' · same id or name' : '' }}
          </option>
        </optgroup>
      </select>
    </FormField>
    <FormField label="The description used in the clip prompts">
      <select v-model="draft.description" aria-label="The description">
        <option value="source" :disabled="!!chosen && !chosen.described">The one written for that picture</option>
        <option value="vision">Written from the picture by the vision model</option>
        <option value="keep">The one {{ role.name }} has here</option>
      </select>
    </FormField>
  </div>
</template>

<style scoped>
.ta-form {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
</style>
