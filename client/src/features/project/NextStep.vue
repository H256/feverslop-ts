<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink} from 'vue-router'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {stageDoes, stageName} from '../plan/stages'
import {usePlanning} from '../plan/usePlanning'
import {useProject} from './session'

/**
 * The next step of the project, under the tabs of every one of its pages (#833): what `bun run status` says, with its button - the
 * run it is, asked first, or the page where it is done - and the estimate. Planning a stage, and the casting photos of a music video
 * planned up to the look, are next to it while the plan is not done.
 */
const {project, root, start, status} = useProject()
const {planStage, renderLookPictures} = usePlanning()
const ask = useAsk()
const toasts = useToasts()

// a stage of the preproduction still to plan: story, cast or look - the shots are the plan run of the status
const preproduction = computed(() => {
  const next = project.value.plan.next
  return next && next !== 'plan' ? next : undefined
})
// "22 step(s) to generate: songStyle, music, …" as "22 step(s) to generate" - the step names are in the title, asked for by pointing (#834)
const said = (why: string) => why.replace(/: [\w-]+(, [\w-]+)+…?$/, '')

const runNext = toasts.guard(async () => {
  const next = status.value?.next
  if (!next?.command) return
  // a render of most of the video - after the shots were planned again every clip is stale (#782): said plainly before it starts
  const clips = status.value?.clips
  const many = clips && /--render=videos/.test(next.command) ? clips.missing + clips.stale : 0
  const yes = await ask({
    title: next.why,
    lines: [next.command, next.estimate],
    warnings: [
      clips &&
        many >= Math.max(10, clips.total / 2) &&
        `This renders ${many} of the ${plural(clips.total, 'clip')}. After a new plan, look at the Direction page and render a few marked clips to check first.`,
    ],
    confirm: 'Run it',
    render: true,
  })
  if (yes) await start({type: 'next', command: next.command})
})
</script>

<template>
  <div v-if="status" class="ns-bar" aria-label="Next step">
    <template v-if="status.next.command || status.next.page">
      <span class="ns-label">Next</span>
      <span class="ns-why" :title="[status.next.why, status.next.command, status.next.estimate].filter(Boolean).join('\n')">{{ said(status.next.why) }}</span>
      <span v-if="status.next.estimate" class="ns-estimate muted">{{ status.next.estimate }}</span>
      <RouterLink v-if="status.next.page" class="btn mini primary" :to="`${root}/${status.next.page}`">Open {{ status.next.page }}</RouterLink>
      <!-- the preproduction is planned stage by stage (#526): the stage next, looked at before the next one is built on it -->
      <button
        v-else-if="preproduction"
        class="btn mini primary"
        :title="stageDoes(preproduction, project.kind)"
        @click="toasts.guard(planStage)(preproduction)"
      >
        Plan the {{ stageName(preproduction, project.kind).toLowerCase() }}
      </button>
      <button v-else class="btn mini primary" @click="runNext">Run it</button>
    </template>
    <span v-else class="ns-why muted">Everything is done</span>
    <button
      v-if="project.kind === 'music' && project.plan.stage === 'look'"
      class="btn mini"
      title="The casting photos: the pictures of the cast and the places, before the shots are planned"
      @click="toasts.guard(renderLookPictures)()"
    >
      Render the pictures
    </button>
    <button
      v-if="project.plan.next && project.plan.next !== 'plan'"
      class="btn mini"
      title="Every stage up to the shots in one run, without stopping"
      @click="toasts.guard(planStage)()"
    >
      Plan everything
    </button>
    <!-- a planned project planned again, from a step or by what changed: the question says what it would do first (#836) -->
    <button
      v-else-if="project.plan.stage === 'plan'"
      class="btn mini"
      title="What a plan run would make again - from a step, or by what changed - asked before it runs"
      @click="toasts.guard(planStage)()"
    >
      Plan again…
    </button>
  </div>
</template>
