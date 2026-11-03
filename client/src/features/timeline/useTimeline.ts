import {computed, reactive, ref, shallowRef, watch} from 'vue'
import type {ClipVersionView, EditorClip, EditorPicture, EditorFreshness, ProjectStatus, RunProgress} from '../../../../shared/workspace'
import {usePolling} from '../../composables/usePolling'
import {plural} from '../../lib/format'
import {useRunDock} from '../../services/run'
import {useProject} from '../project/session'
import {bestSource, flagged, sourceOptions, type Source} from './clips'
import {usePlayback} from './usePlayback'

export type Tab = 'prompt' | 'shots' | 'refs' | 'render' | 'versions'
/** A larger look: over a clip on the timeline (at a second of it), over a <Picture N> in a prompt. x and top: where, on the page. */
export type Peek = {clip?: EditorClip, picture?: EditorPicture, at: number, x: number, top: number}
export type Compared = {clip: EditorClip, version: {video: string, made: number, seed?: number, id?: string, fromThisPlan?: boolean, source?: string}, fresh?: boolean, refined?: string}

/**
 * The timeline of one project: its snapshot as it changes, what is stale, the sound, the monitor, the clips marked for a run together,
 * what a run renders now. The folder is the model: read again every ten seconds and when the window comes back.
 */
export function createTimeline() {
  const session = useProject()
  const {project, api, roots} = session
  const run = useRunDock()
  const fresh = shallowRef<EditorFreshness>({clips: {}, pictures: {}})
  const status = shallowRef<ProjectStatus>()
  const peaks = shallowRef<number[]>()
  const progress = shallowRef<RunProgress>()
  const playback = usePlayback(project, fresh, roots)
  const tab = ref<Tab>('prompt')
  const marked = reactive(new Set<string>())
  const lastMarked = ref<string>()
  const onlyFlagged = ref(false)
  const versions = shallowRef<{clip: string, list: ClipVersionView[]}>()
  const compared = shallowRef<Compared>()
  const helpOpen = ref(false)
  const peek = shallowRef<Peek>()

  const loadFreshness = async () => { fresh.value = await api.freshness() }
  const loadStatus = async () => { status.value = await api.status() }
  const loadWaveform = async () => { peaks.value = (await api.waveform()).peaks ?? undefined }
  /** What hashes or reads the sound comes after the page is up, and again when the project changed. */
  const loadAround = () => Promise.allSettled([loadFreshness(), loadStatus(), loadWaveform()])

  // a choice of what the monitor plays, by hand, stays: here and at the next visit, as long as it is there
  const sourceKey = `source:${session.kind}/${session.id}`
  let sourceChosen = false
  function chooseSource() {
    const known = (value: string | null) => !!value && sourceOptions(project.value).some(o => o.value === value)
    const kept = localStorage.getItem(sourceKey)
    if (!sourceChosen && known(kept)) { playback.source.value = kept!; sourceChosen = true }
    if (!sourceChosen || !known(playback.source.value)) playback.source.value = bestSource(project.value)
  }
  const pickSource = (value: Source) => {
    sourceChosen = true
    localStorage.setItem(sourceKey, value)
    playback.setSource(value)
  }
  /** What was just made current is to be seen: not a final video without it. */
  const forgetSource = () => {
    sourceChosen = false
    localStorage.removeItem(sourceKey)
    chooseSource()
  }
  /** For a review: the clips themselves, the choice before kept to go back to. */
  const holdSource = (value: Source) => {
    const before = {source: playback.source.value, chosen: sourceChosen}
    playback.source.value = value
    sourceChosen = true
    return () => { playback.source.value = before.source; sourceChosen = before.chosen; chooseSource() }
  }

  // the plan or a render changed while the page was open: the same place, in what is there now
  watch(project, (now, before) => {
    const selected = playback.clip.value?.id
    playback.clip.value = now.clips.find(c => c.id === selected)
    versions.value = undefined
    chooseSource()
    playback.songChanged()
    if (before && !playback.playing.value) playback.refresh()
    void loadAround()
  })
  usePolling(() => session.reload(), 10_000)

  // a run that renders: its clips on the timeline, waiting, rendering or done
  const pollProgress = async () => { progress.value = (await api.progress()).progress ?? undefined }
  let progressTimer: ReturnType<typeof setInterval> | undefined
  watch(() => !!run.current.value?.running, running => {
    clearInterval(progressTimer)
    progressTimer = undefined
    if (running) {
      void pollProgress().catch(() => {})
      progressTimer = setInterval(() => { void pollProgress().catch(() => {}) }, 2000)
    } else progress.value = undefined
  }, {immediate: true})
  watch(progress, now => { run.detail.value = now?.total ? `${now.done} of ${plural(now.total, 'clip')} done` : '' })

  /** Ctrl+click marks one, Shift+click all up to this one; a plain click goes there. */
  function clickClip(event: MouseEvent, clip: EditorClip) {
    if (event.ctrlKey || event.metaKey) {
      marked.has(clip.id) ? marked.delete(clip.id) : marked.add(clip.id)
      lastMarked.value = clip.id
    } else if (event.shiftKey) {
      const clips = project.value.clips
      const to = clips.indexOf(clip)
      const found = clips.findIndex(c => c.id === (lastMarked.value ?? playback.clip.value?.id))
      const from = found < 0 ? to : found
      for (const c of clips.slice(Math.min(from, to), Math.max(from, to) + 1)) marked.add(c.id)
      lastMarked.value = clip.id
    } else playback.seek(clip.start)
  }
  const markedClips = computed(() => project.value.clips.filter(c => marked.has(c.id)))
  const isFlagged = (clip: EditorClip) => flagged(clip, fresh.value)
  const markFlagged = () => { for (const c of project.value.clips.filter(isFlagged)) marked.add(c.id) }
  function stepFlagged(direction: number) {
    const clips = project.value.clips.filter(isFlagged)
    if (!clips.length) return
    const t = playback.t.value
    const next = direction > 0 ? clips.find(c => c.start > t + 0.01) ?? clips[0]! : clips.findLast(c => c.start < t - 0.01) ?? clips.at(-1)!
    playback.seek(next.start)
  }
  /** The versions of the clip picked, asked for once per clip and snapshot. */
  async function loadVersions(clip: EditorClip) {
    if (versions.value?.clip === clip.id) return versions.value.list
    const {versions: list} = await api.versions(clip.id)
    versions.value = {clip: clip.id, list}
    return list
  }

  const dispose = () => { clearInterval(progressTimer); run.detail.value = '' }
  return {
    session, project, fresh, status, peaks, progress, playback, tab, marked, markedClips, onlyFlagged, versions, compared, helpOpen, peek,
    loadAround, chooseSource, pickSource, forgetSource, holdSource, clickClip, isFlagged, markFlagged, stepFlagged, loadVersions, dispose,
  }
}
export type Timeline = ReturnType<typeof createTimeline>
