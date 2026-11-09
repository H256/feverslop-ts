<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink} from 'vue-router'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {STAGE_PAGE, STAGES, stageDoes, stageName} from './stages'
import {usePlanning} from './usePlanning'

/** The stages of the plan, what is done and what comes next, with the buttons that plan it. */
const {project, root, busy} = useProject()
const {planStage, renderLookPictures} = usePlanning()
const {guard} = useToasts()
const done = computed(() => (project.value.plan.stage ? STAGES.indexOf(project.value.plan.stage) : -1))
const next = computed(() => project.value.plan.next)
const rendered = computed(() => project.value.clips.some(c => c.video))
const kind = computed(() => project.value.kind)
</script>

<template>
  <div class="stages">
    <template v-for="(stage, n) in STAGES" :key="stage">
      <span v-if="n" class="arrow">›</span>
      <RouterLink v-if="n <= done" class="stage done" :title="stageDoes(stage, kind)" :to="`${root}/${STAGE_PAGE[stage]}`"
        >✓ {{ stageName(stage, kind) }}</RouterLink
      >
      <span v-else :class="['stage', {next: stage === next}]" :title="stageDoes(stage, kind)">{{ stageName(stage, kind) }}</span>
    </template>
    <span class="arrow">›</span>
    <span :class="['stage', {done: rendered}]" title="Rendering: the pictures, the clips and the final video - GPU time, asked for on the timeline"
      >Rendering</span
    >
    <div class="spacer" />
    <button v-if="next" class="btn primary" :disabled="busy" :title="stageDoes(next, kind)" @click="guard(planStage)(next)">
      Plan the {{ stageName(next, kind).toLowerCase() }}
    </button>
    <button
      v-if="kind === 'music' && project.plan.stage === 'look'"
      class="btn"
      :disabled="busy"
      title="The casting photos: the pictures of the cast and the places, before the shots are planned"
      @click="guard(renderLookPictures)()"
    >
      Render the pictures
    </button>
    <button
      v-if="next && next !== 'plan'"
      class="btn"
      :disabled="busy"
      title="Every stage up to the shots in one run, without stopping"
      @click="guard(planStage)()"
    >
      Plan everything
    </button>
  </div>
</template>
