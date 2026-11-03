<script setup lang="ts">
import {toRef} from 'vue'
import {RouterLink} from 'vue-router'
import type {EditorReference, Freshness} from '../../../../shared/workspace'
import SheetMedia from '../../components/SheetMedia.vue'
import VersionCard from '../../components/VersionCard.vue'
import {useDraft} from '../../composables/useDraft'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {plural} from '../../lib/format'
import {FRESH_LABEL, TERMS} from '../../lib/terms'
import {useToasts} from '../../services/toasts'
import {useViewer} from '../../services/viewer'
import {useProject} from '../project/session'
import {useReferenceActions, versionAbout} from './useReferenceActions'

/** One reference picture: what it is made from, its sheet, who uses it, its older versions - and rendering it again. */
const props = defineProps<{reference: EditorReference, fresh?: Freshness}>()
const emit = defineEmits<{changed: []}>()
const {root, roots} = useProject()
const {guard} = useToasts()
const viewer = useViewer()
const prompt = useDraft(() => props.reference.prompt)
// the prompt belongs to this picture: picking another one (the hash) or leaving the page asks first
useUnsavedChanges(() => prompt.dirty.value, 'changes to the prompt', {hash: true})
const actions = useReferenceActions(toRef(props, 'reference'), toRef(props, 'fresh'), async () => emit('changed'))
const exportable = () => props.reference.kind !== 'prop' && !!props.reference.picture
</script>

<template>
  <div>
    <SheetMedia :item="reference" :roots="roots" :name="reference.name" :title="reference.name" :caption="reference.id" :text="reference.description" missing="Not rendered yet">
      <h2>{{ reference.name }}</h2>
      <p class="muted section">{{ reference.kind }} · {{ reference.id }}{{ fresh ? ` · ${FRESH_LABEL[fresh]}` : '' }}</p>
      <div v-if="reference.look" class="note">Another look of {{ reference.look.base }}: {{ reference.look.change }}</div>
      <div v-if="reference.library" class="note">Played by library:{{ reference.library }}. It is not rendered here: change it on the <RouterLink :to="`${root}/casting`">Casting</RouterLink> page.</div>
      <div v-if="fresh === 'pinned' && !reference.library" class="note">Pinned: your own picture, or one made before fingerprints or from an edited prompt. The pipeline leaves it alone.</div>
      <div v-if="fresh === 'stale'" class="warn">Made from another prompt or anchor than the plan has now.</div>
      <div class="section"><h3>Prompt</h3><textarea v-model="prompt.text.value" rows="7" aria-label="Prompt" :disabled="!!reference.look" /></div>
      <div class="section btn-row">
        <button class="btn primary" :disabled="actions.blocked()" :title="actions.blocked() ? 'Pinned or played by the library' : ''" @click="guard(actions.rerender)(false, prompt.text.value)">{{ reference.hasSheet ? 'New sheet, same anchor' : 'Render again' }}</button>
        <button v-if="reference.hasSheet && !reference.look" class="btn" :title="TERMS.Anchor" :disabled="actions.blocked()" @click="guard(actions.rerender)(true, prompt.text.value)">New anchor</button>
        <button v-if="exportable()" class="btn" @click="guard(actions.putIntoLibrary)()">Put into the library</button>
      </div>
    </SheetMedia>
    <div class="section">
      <h3>Used by {{ plural(reference.clips.length, 'clip') }}</h3>
      <div class="btn-row"><RouterLink v-for="clip in reference.clips" :key="clip" class="chip" :to="`${root}/#${clip}`">{{ clip }}</RouterLink></div>
    </div>
    <div v-if="reference.versions.length" class="section">
      <h3>Older versions</h3>
      <VersionCard v-for="version in reference.versions" :key="version.id" :picture="version.picture" :roots="roots" :made="version.made" :about="versionAbout(version)" @view="viewer.open(version.picture, roots, 'Older version', reference.name, version.prompt)">
        <button class="btn" :disabled="!!reference.library" @click="guard(actions.pick)(version)">Make current</button>
      </VersionCard>
    </div>
  </div>
</template>
