<script setup lang="ts">
import {computed} from 'vue'
import {RouterLink} from 'vue-router'
import type {EditorClip} from '../../../../../shared/workspace'
import {thumbUrl} from '../../../api/urls'
import CopyCommand from '../../../components/CopyCommand.vue'
import {withNames} from '../../../lib/format'
import {useViewer} from '../../../services/viewer'
import {useTimeline} from '../context'

/**
 * The beat or scene of the clip, its shots, and what is sung or said in it. Who sings a line is changed on a page of its own.
 * Each shot shows its start picture (#1187) - drawn by the CLI (--render=startframes), locked at the shot's first frame when the
 * clip is rendered; drawn again from here, one shot or all of them.
 */
const props = defineProps<{clip: EditorClip}>()
const {project, session, direct, actions} = useTimeline()
const viewer = useViewer()
const drawn = computed(() => props.clip.shots.filter(s => s.startFrame).length)
const command = computed(() => `${project.value.command} --render=startframes --only=${props.clip.id}${drawn.value ? ' --again' : ''}`)
const draw = (n?: number) => actions.drawStartFrames(props.clip, n)
</script>

<template>
  <div v-if="clip.context.text || clip.context.staging" class="section">
    <h3>{{ clip.context.label }}</h3>
    <p v-if="clip.context.text">{{ withNames(clip.context.text) }}</p>
    <p v-if="clip.context.staging" class="muted u-mt-1">{{ withNames(clip.context.staging) }}</p>
  </div>
  <div class="section">
    <h3>Shots</h3>
    <div v-if="project.kind === 'music'" class="btn-row">
      <button class="btn" title="One still per shot: who stands where, drawn once and locked at the shot's first frame" @click="draw()">
        {{ drawn ? 'Draw all start pictures again' : 'Draw start pictures' }}
      </button>
    </div>
    <article v-for="(shot, n) in clip.shots" :key="shot.label" class="shot">
      <header>
        <span>{{ shot.label.replace(/^\[|\]$/g, '') }}</span
        ><span class="num">{{ shot.at }}s</span>
      </header>
      <figure v-if="shot.startFrame" class="sf-picture">
        <img
          :src="thumbUrl(shot.startFrame, session.roots, 640)"
          :alt="`Start picture of shot ${n + 1}`"
          loading="lazy"
          decoding="async"
          @click="viewer.open(shot.startFrame!, session.roots, `Start picture of shot ${n + 1}`, clip.id)"
        />
      </figure>
      <button v-if="project.kind === 'music'" class="btn" @click="draw(n)">{{ shot.startFrame ? 'Draw again' : 'Draw start picture' }}</button>
      <button
        v-if="shot.directionId"
        class="btn"
        title="Who is in it and what each of them does - take someone out, set the size, or tell the language model what to change"
        @click="direct(shot.directionId)"
      >
        Direct this shot
      </button>
      <p class="how">{{ [shot.framing, shot.camera].filter(Boolean).join(' · ') }}</p>
      <p v-if="shot.action">{{ withNames(shot.action) }}</p>
      <div v-for="person in shot.people" :key="person.name" class="person">
        <b>{{ person.name }}</b> {{ withNames(person.text) }}
      </div>
    </article>
  </div>
  <div v-if="clip.lines.length" class="section">
    <h3>
      {{ project.kind === 'film' ? 'Dialogue' : 'Sung' }}
      <RouterLink v-if="project.sings" class="link u-sans u-plain u-ml-2" :to="`${session.root}/singers#line-${clip.lines[0]!.line}`"
        >Change singers</RouterLink
      >
    </h3>
    <div v-for="(line, n) in clip.lines" :key="n" class="line">
      <time>{{ line.at.toFixed(1) }}s</time>
      <div>
        {{ line.text }}<small v-if="line.who">{{ line.who }}</small>
      </div>
    </div>
  </div>
  <div v-if="project.kind === 'music'" class="section">
    <h3>Start pictures in the terminal</h3>
    <CopyCommand :command="command" />
  </div>
</template>

<style scoped>
.sf-picture {
  margin: var(--space-2) 0;
}
.sf-picture img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radius-s);
  cursor: zoom-in;
}
</style>
