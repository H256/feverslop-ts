<script setup lang="ts">
import type {EditorClip, EditorPicture} from '../../../../../shared/workspace'
import MediaThumb from '../../../components/MediaThumb.vue'
import FactList from '../../../components/FactList.vue'
import {TERMS} from '../../../lib/terms'
import {useViewer} from '../../../services/viewer'
import {useTimeline} from '../context'
import OverridePanel from './OverridePanel.vue'

/** The pictures and the sound the clip is made from - and, for a film, the clip's own choice of them. */
const props = defineProps<{clip: EditorClip}>()
const {project, fresh, session} = useTimeline()
const viewer = useViewer()
const why = (picture: EditorPicture) => {
  const views = props.clip.views
  if (picture.kind === 'location') return views?.chosen ? `view ${views.chosen}: ${views.options[views.chosen - 1]?.name}` : 'the place'
  return picture.kind === 'frame' ? 'the frame it goes on from' : picture.kind
}
const freshOf = (picture: EditorPicture) => {
  const job = project.value.pictures.find(p => p.file === picture.file)
  return job ? fresh.value.pictures[job.id] : undefined
}
const open = (picture: EditorPicture) => { if (picture.exists) viewer.open(picture, session.roots, picture.label, picture.name, picture.description) }
</script>

<template>
  <div class="section">
    <h3>Pictures</h3>
    <div class="refs">
      <button v-for="picture in clip.pictures" :key="picture.label" class="ref" :title="picture.description" @click="open(picture)">
        <MediaThumb :media="picture.exists ? picture : undefined" :roots="session.roots" :width="640" :alt="picture.name" cls="" missing="Missing" />
        <div>
          <b>{{ picture.name || picture.label }}</b>
          <small>{{ picture.label.replace(/[<>]/g, '') }} · {{ why(picture) }}<span v-if="freshOf(picture) === 'stale'" class="stale" :title="TERMS.Stale">stale</span><span v-if="freshOf(picture) === 'pinned'" :title="TERMS.Pinned">pinned</span></small>
        </div>
      </button>
    </div>
  </div>
  <div v-if="clip.audio.length" class="section">
    <h3>Sound</h3>
    <FactList :facts="clip.audio.map(a => ({name: a.label.replace(/[<>]/g, ''), value: `${a.stem ?? ''} · ${a.songStart.toFixed(1)}s – ${a.songEnd.toFixed(1)}s of the song`}))" />
  </div>
  <OverridePanel v-if="project.kind === 'film'" :clip="clip" />
</template>
