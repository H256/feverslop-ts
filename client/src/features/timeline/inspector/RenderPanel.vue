<script setup lang="ts">
import {computed} from 'vue'
import type {EditorClip} from '../../../../../shared/workspace'
import {mediaUrl, thumbUrl} from '../../../api/urls'
import CopyCommand from '../../../components/CopyCommand.vue'
import FactList, {type Fact} from '../../../components/FactList.vue'
import {joined} from '../../../lib/format'
import {useViewer} from '../../../services/viewer'
import {stateOf} from '../clips'
import {useTimeline} from '../context'
import RetakeSection from './RetakeSection.vue'

/** Rendering the clip again, a part of it or a preview; its files, the clips it goes on from and into, its frames, the command. */
const props = defineProps<{clip: EditorClip}>()
const {project, fresh, playback, session, actions, compare} = useTimeline()
const viewer = useViewer()
const c = computed(() => props.clip)
const files = computed((): Fact[] => [
  {name: 'Video', value: c.value.video?.file ?? 'not rendered', key: 'video'},
  {name: 'Preview', value: c.value.preview?.file, key: 'preview'},
  {name: 'Workflow', value: c.value.video?.workflow},
  {name: 'Size', value: c.value.video?.size},
  {name: 'Seed', value: c.value.video?.seed === undefined ? undefined : String(c.value.video.seed)},
  {name: 'Frames', value: c.value.video?.renderedFrames ? `${c.value.frames} of ${c.value.video.renderedFrames} used` : `${c.value.frames}`},
  {name: 'From frame', value: String(c.value.frameStart)},
])
const links = computed((): Fact[] => [
  {name: 'From', value: c.value.startsFrom},
  {name: 'Into', value: c.value.next},
])
const frames = computed(() =>
  (
    [
      ['First frame', c.value.firstFrame],
      ['Last frame', c.value.lastFrame],
    ] as const
  ).filter(([, frame]) => frame),
)
const command = computed(() => `${project.value.command} --render=videos --only=${c.value.id}${c.value.video ? ' --again' : ''}`)
const jump = (id: string) => {
  const target = project.value.clips.find(x => x.id === id)
  if (target) playback.seek(target.start)
}
const compareRefined = (version: EditorClip['refined'][number]) =>
  compare({clip: c.value, version: {video: version.file, made: version.v, seed: version.seed}, refined: version.variant})
</script>

<template>
  <div v-if="stateOf(clip, fresh) === 'stale'" class="warn">Made from another prompt, picture or start frame than the plan has now.</div>
  <div class="section btn-row">
    <button class="btn primary" @click="actions.renderAgain(clip)">{{ clip.video ? 'Render again' : 'Render' }}</button>
    <button class="btn" @click="actions.preview([clip], clip.id)">{{ clip.preview ? 'Preview again' : 'Preview' }}</button>
  </div>
  <RetakeSection v-if="clip.video" :key="clip.id" :clip="clip" />
  <div v-if="clip.refined.length" class="section">
    <h3>Larger versions</h3>
    <article v-for="version in clip.refined" :key="version.variant" class="version version-one">
      <div>
        <div>{{ version.variant }}</div>
        <div class="muted num">
          {{
            joined([
              version.size?.replace('x', '×'),
              version.denoise !== undefined && `denoise ${version.denoise}`,
              version.seed !== undefined && `seed ${version.seed}`,
            ])
          }}
        </div>
        <div class="btn-row"><button v-if="clip.video" class="btn" @click="compareRefined(version)">Compare with the original</button></div>
      </div>
    </article>
  </div>
  <div class="section">
    <h3>File</h3>
    <FactList :facts="files">
      <template #value="{fact}">
        <a v-if="fact.key === 'video' && clip.video" :href="mediaUrl(clip.video, session.roots)" target="_blank" rel="noopener">{{ fact.value }}</a>
        <a v-else-if="fact.key === 'preview' && clip.preview" :href="mediaUrl(clip.preview, session.roots)" target="_blank" rel="noopener">{{ fact.value }}</a>
        <template v-else>{{ fact.value }}</template>
      </template>
    </FactList>
  </div>
  <div v-if="clip.startsFrom || clip.next" class="section">
    <h3>Goes on</h3>
    <FactList :facts="links"
      ><template #value="{fact}"
        ><button class="link" @click="jump(fact.value!)">{{ fact.value }}</button></template
      ></FactList
    >
  </div>
  <div v-if="frames.length" class="section">
    <h3>Frames</h3>
    <div class="frames">
      <figure v-for="[name, frame] in frames" :key="name">
        <img
          :src="thumbUrl(frame!, session.roots, 640)"
          :alt="name"
          loading="lazy"
          decoding="async"
          @click="viewer.open(frame!, session.roots, name, clip.id)"
        />
        <figcaption>{{ name }}</figcaption>
      </figure>
    </div>
  </div>
  <div class="section">
    <h3>The same in the terminal</h3>
    <CopyCommand :command="command" />
  </div>
</template>
