<script setup lang="ts">
import {RouterLink} from 'vue-router'
import type {EditorClip} from '../../../../../shared/workspace'
import {withNames} from '../../../lib/format'
import {useTimeline} from '../context'

/** The beat or scene of the clip, its shots, and what is sung or said in it. Who sings a line is changed on a page of its own. */
defineProps<{clip: EditorClip}>()
const {project, session, direct} = useTimeline()
</script>

<template>
  <div v-if="clip.context.text || clip.context.staging" class="section">
    <h3>{{ clip.context.label }}</h3>
    <p v-if="clip.context.text">{{ withNames(clip.context.text) }}</p>
    <p v-if="clip.context.staging" class="muted" style="margin-top: 4px">{{ withNames(clip.context.staging) }}</p>
  </div>
  <div class="section">
    <h3>Shots</h3>
    <article v-for="shot in clip.shots" :key="shot.label" class="shot">
      <header>
        <span>{{ shot.label.replace(/^\[|\]$/g, '') }}</span
        ><span class="num">{{ shot.at }}s</span>
      </header>
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
      <RouterLink
        v-if="project.sings"
        class="link"
        style="margin-left: 8px; font-family: var(--sans); text-transform: none; letter-spacing: 0"
        :to="`${session.root}/singers#line-${clip.lines[0]!.line}`"
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
</template>
