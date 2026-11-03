import {h, reactive} from 'vue'
import type {EditorClip, EditorOverride, LastRun, ProjectStatus, RunInfo, RunRequest} from '../../../../shared/workspace'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import AddViewForm, {type NewView} from './AddViewForm.vue'
import {chain} from './clips'
import RefinishForm, {type Refinish} from './RefinishForm.vue'
import type {Timeline} from './useTimeline'

/** What can be asked for on the timeline, each asked first - what it costs, what goes stale - and then run. */
export function useClipActions(timeline: Timeline) {
  const ask = useAsk()
  const toasts = useToasts()
  const {project, session, playback, marked, markedClips} = timeline
  const {api, start} = session
  const seedNote = (fixedSeed: number | undefined, what: string) => fixedSeed !== undefined && `"seed" is fixed in config.json (${fixedSeed}): the same seed gives the same ${what} again.`
  const goesOn = (later: string[], what: string) => later.length > 0 && `${later.join(', ')} go on from ${what}. They go stale and are not rendered on their own.`

  async function renderAgain(clip: EditorClip) {
    const asked = await api.estimateClips([clip.id]).catch(() => undefined)
    const yes = await ask({
      title: `Render ${clip.id}${clip.video ? ' again' : ''}?`,
      lines: [clip.video && 'A new seed. The version there now is put away and stays selectable.', asked?.estimate],
      warnings: [...asked?.risks ?? [], seedNote(asked?.fixedSeed, 'clip'), goesOn(chain(project.value, clip), 'this clip')],
      confirm: 'Render it',
      render: true,
    })
    if (yes) await start({type: 'clips', ids: [clip.id], again: !!clip.video})
  }
  async function renderMarked() {
    const clips = markedClips.value
    const asked = await api.estimateClips(clips.map(c => c.id)).catch(() => undefined)
    const later = [...new Set(clips.flatMap(c => chain(project.value, c)))].filter(id => !marked.has(id))
    const again = clips.some(c => c.video)
    const yes = await ask({
      title: `Render ${plural(clips.length, 'clip')}${again ? ' again' : ''}?`,
      lines: [clips.map(c => c.id).join(', '), again && 'A new seed each. What is there now is put away and stays selectable.', asked?.estimate],
      warnings: [...asked?.risks ?? [], seedNote(asked?.fixedSeed, 'clips'), goesOn(later, 'these clips')],
      confirm: 'Render them',
      render: true,
    })
    if (!yes) return
    await start({type: 'clips', ids: clips.map(c => c.id), again})
    marked.clear()
  }
  async function preview(clips: EditorClip[], label: string) {
    const yes = await ask({
      title: `Preview ${label}?`,
      lines: ['A cheap render into previews/: fewer steps, a fraction of the pixels. It never replaces a clip.'],
      warnings: [clips.some(c => c.startsFrom) && 'A clip that goes on from another starts on the last frame of its preview and is marked as approximate.'],
      confirm: 'Preview',
      render: true,
    })
    if (yes) await start({type: 'clips', ids: clips.map(c => c.id), preview: true, again: clips.some(c => c.preview)})
  }
  /** A part of a clip rendered again, between the frames around it. */
  async function retake(clip: EditorClip, range: string, from: number, to: number) {
    const seconds = clip.end - clip.start
    if (project.value.kind === 'film' && clip.lines.some(line => line.at < to && (line.end ?? seconds) > from)) throw new Error('A part with dialogue cannot be rendered on its own yet: the sound of a film comes with the picture.')
    const yes = await ask({
      title: `Render ${clip.id}: ${range} again?`,
      lines: ['Only this part, between the frames around it. The whole clip is put away first and stays selectable. The final video is not assembled on its own.'],
      warnings: ['Not proven yet: on a 32 GB Radeon the two-pass job ran out of memory, and one try took the server down (#157).', to >= seconds - 0.05 && clip.next && `This part reaches the end of the clip: ${chain(project.value, clip).join(', ')} go on from its last frame and are marked.`],
      confirm: 'Render it anyway',
      render: true,
    })
    if (yes) await start({type: 'retake', clip: clip.id, range})
  }
  async function refinish() {
    const form = reactive<Refinish>({preset: 'grade', upscale: 'none', size: 'fullhd', denoise: 0.2, fps: '24', finish: true})
    const picked = markedClips.value
    const yes = await ask({
      title: 'Make this project over',
      lines: [
        'From the clips it has: no plan run, no new prompts. videos/ and the final video stay as they are; the clips of a variant get a folder of their own, its final videos a name of their own.',
        picked.length ? `Only the ${plural(picked.length, 'marked clip')}: larger clips, no final video.` : 'All clips, and the final videos.',
      ],
      warnings: ['Refine is slow, about 6 s per frame on the Radeon, and can change mouths a little: try a marked clip first, and compare.'],
      body: () => h(RefinishForm, {modelValue: form}),
      confirm: 'Start',
      render: true,
    })
    if (!yes) return
    const only = picked.length ? {only: picked.map(c => c.id)} : {}
    await start(form.preset === 'custom'
      ? {type: 'refinish', upscale: form.upscale, size: form.size, denoise: Number(form.denoise), fps: Number(form.fps), finish: form.finish, ...only}
      : {type: 'refinish', preset: form.preset, ...only})
  }
  async function pickVersion(clip: EditorClip, version: {id: string, fromThisPlan?: boolean, source?: string}) {
    const later = chain(project.value, clip)
    const yes = await ask({
      title: `Make this version of ${clip.id} the current one?`,
      lines: ['What is there now is put away and stays selectable. The final video is then older than its clips.'],
      warnings: [
        version.fromThisPlan === false && 'It was made from another plan and counts as stale.',
        version.source === 'leak' && 'It has only its video. Its first and last frame are made by the next run.',
        later.length > 0 && `${later.join(', ')} go on from this clip and are marked.`,
      ],
      confirm: 'Make it current',
    })
    if (!yes) return
    if (playback.playing.value) playback.setPlaying(false)
    await api.pickVersion(clip.id, version.id)
    timeline.versions.value = undefined
    await session.reload()
    timeline.forgetSource()
    playback.seek(playback.t.value)
    toasts.show(`${clip.id} is now that version`)
  }
  /** A film clip's own choice of its place's view and its references: kept in a small file, the plan is not touched. */
  async function saveOverride(clip: EditorClip, override: EditorOverride | null) {
    await api.override(clip.id, override)
    await session.reload()
    toasts.show('Kept for this clip. It takes effect with the next plan run, and the clip then goes stale.')
  }
  async function addView(clip: EditorClip) {
    if (!clip.views) return
    const view = reactive<NewView>({name: '', shows: ''})
    const yes = await ask({
      title: 'One more view of this place',
      lines: ['For where the sheet has no view that fits. Rendered from the anchor of the place, so the look stays the same. It appears here to choose from.'],
      body: () => h(AddViewForm, {modelValue: view}),
      confirm: 'Render it',
      render: true,
    })
    if (yes) await start({type: 'add-view', location: clip.views.locationId, name: view.name, shows: view.shows})
  }
  async function repeatLast(last: LastRun) {
    const yes = await ask({title: 'Run this again?', lines: [last.command], confirm: 'Run it', render: true})
    if (yes) await start({type: 'repeat', command: last.command})
  }
  async function runNext(next: ProjectStatus['next']) {
    if (!next.command) return
    const yes = await ask({title: next.why, lines: [next.command, next.estimate], confirm: 'Run it', render: true})
    if (yes) await start({type: 'next', command: next.command})
  }
  const plain = (action: RunRequest) => start(action)
  const plan = () => start({type: 'plan'})

  /** After a render of clips that were there before: what came out against what was there - one compared, several reviewed. */
  async function afterRender(current: RunInfo | null, action: RunRequest | undefined, review: (clips: EditorClip[]) => void) {
    if (current?.code || action?.type !== 'clips' || !action.again || action.preview) return
    const clips = project.value.clips.filter(c => action.ids.includes(c.id) && c.video)
    if (clips.length !== 1) return review(clips)
    const {versions} = await api.versions(clips[0]!.id)
    if (versions[0]) timeline.compared.value = {clip: clips[0]!, version: versions[0], fresh: true}
  }

  const guarded = <A extends unknown[]>(action: (...args: A) => Promise<unknown>) => toasts.guard(action)
  return {
    renderAgain: guarded(renderAgain), renderMarked: guarded(renderMarked), preview: guarded(preview), retake: guarded(retake),
    refinish: guarded(refinish), pickVersion: guarded(pickVersion), saveOverride: guarded(saveOverride), addView: guarded(addView),
    repeatLast: guarded(repeatLast), runNext: guarded(runNext), plain: guarded(plain), plan: guarded(plan),
    renderMarkedNow: renderMarked, afterRender,
  }
}
export type ClipActions = ReturnType<typeof useClipActions>
