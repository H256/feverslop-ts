import type {
  BookView, CastChange, CastingRedo, CastingView, CastResult, CastView, ClipVersionView, EditorFreshness, EditorOverride, EditorProject,
  EditorReference, Estimate, LookChange, LookResult, LookView, ProjectStatus, RunInfo, RunProgress, RunRequest, SingingChange,
  SingingResult, SingingView, StoryForCast, StoryResult, TimingChange, TimingResult, TimingView,
} from '../../../shared/workspace'
import {getJson, HttpError, postJson} from './http'

const id = (value: string) => encodeURIComponent(value)

/** Every endpoint of one project, by name: the routes of lib/editor/server.ts under /p/<kind>/<id>/api. */
export function projectApi(root: string) {
  const get = <T>(path: string, signal?: AbortSignal) => getJson<T>(`${root}/api/${path}`, signal)
  const post = <T>(path: string, body: unknown) => postJson<T>(`${root}/api/${path}`, body)
  return {
    root,
    events: `${root}/api/run-events`,
    /** The raw text: a snapshot that did not change is not taken over, and nothing on the page is drawn again. */
    projectText: async (signal?: AbortSignal) => {
      const response = await fetch(`${root}/api/project`, {signal})
      const text = await response.text()
      if (!response.ok) {
        let said = `Request failed (${response.status})`
        try { said = (JSON.parse(text) as {error?: string}).error ?? said } catch {}
        throw new HttpError(said, response.status)
      }
      return text
    },
    freshness: (signal?: AbortSignal) => get<EditorFreshness>('freshness', signal),
    status: (signal?: AbortSignal) => get<ProjectStatus>('status', signal),
    waveform: (signal?: AbortSignal) => get<{peaks: number[] | null}>('waveform', signal),
    progress: (signal?: AbortSignal) => get<{progress: RunProgress | null}>('progress', signal),
    versions: (clip: string, signal?: AbortSignal) => get<{versions: ClipVersionView[]}>(`versions/${id(clip)}`, signal),
    references: (signal?: AbortSignal) => get<{references: EditorReference[]}>('references', signal),
    singing: (signal?: AbortSignal) => get<{singing: SingingView | null}>('singing', signal),
    timing: (signal?: AbortSignal) => get<{timing: TimingView | null}>('timing', signal),
    timingWave: (signal?: AbortSignal) => get<{peaks: number[] | null}>('timing-wave', signal),
    casting: (signal?: AbortSignal) => get<CastingView>('casting', signal),
    castingRedo: (signal?: AbortSignal) => get<CastingRedo>('casting-redo', signal),
    cast: (signal?: AbortSignal) => get<{cast: CastView | null}>('cast', signal),
    book: (signal?: AbortSignal) => get<BookView>('book', signal),
    look: (signal?: AbortSignal) => get<LookView>('look', signal),

    run: (action: RunRequest, servers?: string[]) => post<{run: RunInfo}>('run', {action, ...(servers ? {servers} : {})}),
    stop: () => post<{stopped: boolean}>('stop', {}),
    estimateClips: (clips: string[]) => post<Estimate>('estimate', {clips}),
    estimatePictures: (pictures: number) => post<Estimate>('estimate', {pictures}),
    pickVersion: (clip: string, version: string) => post<unknown>(`versions/${id(clip)}/pick`, {version}),
    rerender: (picture: string, body: {newAnchor: boolean, prompt?: string, servers?: string[]}) => post<{run: RunInfo}>(`references/${id(picture)}/rerender`, body),
    pickReference: (picture: string, version: string) => post<unknown>(`references/${id(picture)}/pick`, {version}),
    setCasting: (body: {kind: 'character' | 'location', id: string, value: string}) => post<{written: true}>('casting', body),
    saveSinging: (change: SingingChange) => post<SingingResult>('singing', change),
    saveCast: (change: CastChange) => post<CastResult>('cast', change),
    storyForCast: (body: StoryForCast) => post<StoryResult>('book/for-cast', body),
    dropStoryProposal: () => post<{dropped: true}>('book/drop-proposal', {}),
    saveStory: (text: string) => post<StoryResult>('book', {text}),
    saveLook: (change: LookChange) => post<LookResult>('look', change),
    saveTiming: (change: TimingChange) => post<TimingResult>('timing', change),
    override: (clip: string, override: EditorOverride | null) => post<{written: true}>(`override/${id(clip)}`, override),
  }
}
export type ProjectApi = ReturnType<typeof projectApi>
