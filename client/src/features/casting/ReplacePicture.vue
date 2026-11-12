<script setup lang="ts">
import CalloutBox from '../../components/CalloutBox.vue'
import {shallowRef, watch} from 'vue'
import FormField from '../../components/FormField.vue'
import {errorText} from '../../lib/format'

/**
 * A character's picture replaced in what is planned (#835): a picture on this machine, the description that goes with it, and what
 * the command would do - `bun run replace-character … --dry-run` - read again as the choice changes. The question around it starts it.
 */
const props = defineProps<{
  draft: {picture: string; describe: 'vision' | 'keep' | 'text'; text: string; renderSheet: boolean}
  dryRun: (asked: {picture: string; description: string}) => Promise<{lines: string[]}>
}>()
const said = shallowRef<string[]>([])
const failed = shallowRef('')
let asked = 0
const ask = async () => {
  const mine = ++asked
  failed.value = ''
  said.value = []
  if (!props.draft.picture.trim()) return
  try {
    const description = props.draft.describe === 'text' ? props.draft.text || 'keep' : props.draft.describe
    const answer = await props.dryRun({picture: props.draft.picture, description})
    if (mine === asked) said.value = answer.lines
  } catch (e) {
    if (mine === asked) failed.value = errorText(e)
  }
}
watch(
  () => [props.draft.picture, props.draft.describe],
  () => void ask(),
)
</script>

<template>
  <div class="rp-form">
    <FormField label="The new picture - a file on this machine"
      ><input v-model.lazy="draft.picture" type="text" placeholder="D:\pictures\ann.png" aria-label="The new picture"
    /></FormField>
    <FormField label="The description used in the clip prompts">
      <select v-model="draft.describe" aria-label="The description">
        <option value="vision">Written from the new picture by the vision model</option>
        <option value="keep">The one there is now</option>
        <option value="text">Written here</option>
      </select>
    </FormField>
    <FormField v-if="draft.describe === 'text'" label="The description"><textarea v-model="draft.text" rows="3" /></FormField>
    <label class="rp-check"><input v-model="draft.renderSheet" type="checkbox" /> Render the new reference sheet right away</label>
    <div v-if="said.length" class="rp-said" aria-label="What it would do">
      <b>What it would do</b>
      <p v-for="line in said" :key="line" class="muted">{{ line }}</p>
    </div>
    <CalloutBox v-if="failed" kind="warn">{{ failed }}</CalloutBox>
  </div>
</template>

<style scoped>
.rp-form {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
.rp-check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.rp-said p {
  margin: 0;
}
</style>
