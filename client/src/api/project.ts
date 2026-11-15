import type {
  AssetSource,
  BeatCastChange,
  BeatCastResult,
  BookView,
  CastChange,
  CastingRedo,
  CastingView,
  CastResult,
  CastView,
  ClipVersionView,
  ConfigChange,
  ConfigImpact,
  ConfigResult,
  ConfigView,
  DryRun,
  EditorFreshness,
  EditorOverride,
  EditorReference,
  Estimate,
  LookChange,
  LookResult,
  LookView,
  ProjectStatus,
  QueuedRun,
  RunHistory,
  RunInfo,
  RunRequest,
  SingingChange,
  SingingResult,
  SingingView,
  StoryForCast,
  StoryResult,
  TimingChange,
  TimingResult,
  TimingView,
  LipsyncView,
} from '../../../shared/workspace'
import {errorOfAnswer, getJson, postForm, postJson} from './http'
import type {DirectionEdit, DirectionRule, DirectionView} from '../../../shared/direction'
import type {TimingRefinement, RefinementLanguage, ConfirmedPassage} from '../../../shared/timing-refinement'

const id = (value: string) => encodeURIComponent(value)

/** Every endpoint of one project, by name: the routes of lib/editor/server.ts under /p/<kind>/<id>/api. */
export function projectApi(root: string) {
  const get = <T>(path: string, signal?: AbortSignal) => getJson<T>(`${root}/api/${path}`, signal)
  const post = <T>(path: string, body: unknown) => postJson<T>(`${root}/api/${path}`, body)
  // The rules and edits as last read or saved (#990): a save says what it was made from, and the server refuses it when another tab or
  // an older view changed them since - nothing another one saved is replaced without notice.
  let seenRules: string | undefined
  let seenEdits: string | undefined
  const remember = <V extends DirectionView>(view: V): V => {
    seenRules = JSON.stringify(view.rules)
    seenEdits = JSON.stringify(view.edits)
    return view
  }
  return {
    root,
    events: `${root}/api/run-events`,
    /** The raw text: a snapshot that did not change is not taken over, and nothing on the page is drawn again. */
    projectText: async (signal?: AbortSignal) => {
      const response = await fetch(`${root}/api/project`, {signal})
      const text = await response.text()
      if (!response.ok) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {}
        throw errorOfAnswer(body, response.status)
      }
      return text
    },
    freshness: (signal?: AbortSignal) => get<EditorFreshness>('freshness', signal),
    status: (signal?: AbortSignal) => get<ProjectStatus>('status', signal),
    waveform: (signal?: AbortSignal) => get<{peaks: number[] | null}>('waveform', signal),
    versions: (clip: string, signal?: AbortSignal) => get<{versions: ClipVersionView[]}>(`versions/${id(clip)}`, signal),
    references: (signal?: AbortSignal) => get<{references: EditorReference[]}>('references', signal),
    singing: (signal?: AbortSignal) => get<{singing: SingingView | null}>('singing', signal),
    timing: (signal?: AbortSignal) => get<{timing: TimingView | null}>('timing', signal),
    lipsync: (signal?: AbortSignal) => get<{lipsync: LipsyncView | null}>('lipsync', signal),
    timingWave: (signal?: AbortSignal) => get<{peaks: number[] | null}>('timing-wave', signal),
    casting: (signal?: AbortSignal) => get<CastingView>('casting', signal),
    /** The finished characters or places of the other music videos (#835): what import-asset can take over. */
    /** What replacing a character's picture would do: bun run replace-character … --dry-run (#835). */
    replaceDryRun: (asked: {character: string; picture: string; description: string}) => post<{lines: string[]}>('replace-dry-run', asked),
    assetSources: (kind: 'character' | 'location') => get<{sources: AssetSource[]}>(`asset-sources?kind=${kind}`),
    castingRedo: (signal?: AbortSignal) => get<CastingRedo>('casting-redo', signal),
    cast: (signal?: AbortSignal) => get<{cast: CastView | null}>('cast', signal),
    book: (signal?: AbortSignal) => get<BookView>('book', signal),
    direction: async (signal?: AbortSignal) => remember(await get<DirectionView>('direction', signal)),
    saveDirection: async (rules: DirectionRule[]) => remember(await post<DirectionView>('direction', {rules, basedOn: seenRules})),
    // rebuild: the server builds the clip prompts again in the same request and answers with the run it started (#830) - for the
    // edits only when none of them waits for its words
    saveDirectionEdits: async (edits: DirectionEdit[], rebuild?: {servers?: string[]}) =>
      remember(await post<DirectionView & {run?: RunInfo}>('direction/edits', {edits, basedOn: seenEdits, ...(rebuild ? {rebuild: true, ...rebuild} : {})})),
    takeDirection: async (despiteConflicts: boolean, rebuild: {servers?: string[]}) =>
      remember(await post<DirectionView & {run?: RunInfo}>('direction/take', {despiteConflicts, rebuild: true, ...rebuild})),
    // rebuild: given when people were taken out for the proposal to write - dropped, the prompts are built now (#830)
    dropDirection: async (rebuild?: {servers?: string[]}) =>
      remember(await post<DirectionView & {run?: RunInfo}>('direction/drop', rebuild ? {rebuild: true, ...rebuild} : {})),
    // people into one shot or out of it, and the run that follows - the proposal that writes the shot, or the prompts built (#830)
    shotPeople: async (change: {shotId: string; add?: string[]; remove?: string[]; words?: string}, rebuild: {servers?: string[]}) =>
      remember(await post<DirectionView & {run: RunInfo; proposing: boolean}>('direction/people', {...change, ...rebuild})),
    restoreDirection: async (version: string, rebuild: {servers?: string[]}) =>
      remember(await post<DirectionView & {run?: RunInfo}>('direction/restore', {version, rebuild: true, ...rebuild})),
    look: (signal?: AbortSignal) => get<LookView>('look', signal),
    config: (signal?: AbortSignal) => get<ConfigView>('config', signal),
    /** Can the project's language model read a picture: a description from an uploaded picture is offered only then. */
    vision: (signal?: AbortSignal) => get<{readable: boolean}>('vision', signal),

    run: (action: RunRequest, servers?: string[]) => post<{run: RunInfo}>('run', {action, ...(servers ? {servers} : {})}),
    /** Starts it, or puts it behind the run that goes on (#837). */
    runOrQueue: (action: RunRequest, servers?: string[]) =>
      post<{run: RunInfo} | {queued: QueuedRun}>('run', {action, queue: true, ...(servers ? {servers} : {})}),
    /** The queue and the runs that ended: bun run runs (#837). */
    runs: (signal?: AbortSignal) => get<RunHistory>('runs', signal),
    unqueue: (queued: string) => post<{queue: QueuedRun[]}>('runs', {remove: queued}),
    stop: () => post<{stopped: boolean}>('stop', {}),
    estimateClips: (clips: string[]) => post<Estimate>('estimate', {clips}),
    estimatePictures: (pictures: number) => post<Estimate>('estimate', {pictures}),
    /** What a plan run would do: `bun index.ts <id> --dry-run --json` (#836); null for a film. */
    dryRun: (plan: {redo?: string[]; until?: string; scenes?: string[]}) => post<{dryRun: DryRun}>('dry-run', plan),
    pickVersion: (clip: string, version: string) => post<unknown>(`versions/${id(clip)}/pick`, {version}),
    /** The user's own picture as its anchor: picture, prompt, description or describe, servers - as a form, the picture as it is. */
    // queue (a form field "queue" for the upload): while a run goes on, it waits behind it (#837)
    ownAnchor: (picture: string, form: FormData) => postForm<{run: RunInfo} | {queued: QueuedRun}>(`${root}/api/references/${id(picture)}/own-anchor`, form),
    rerender: (picture: string, body: {newAnchor: boolean; prompt?: string; servers?: string[]; queue?: boolean}) =>
      post<{run: RunInfo} | {queued: QueuedRun}>(`references/${id(picture)}/rerender`, body),
    pickReference: (picture: string, version: string) => post<unknown>(`references/${id(picture)}/pick`, {version}),
    setCasting: (body: {kind: 'character' | 'location'; id: string; value: string}) => post<{written: true}>('casting', body),
    saveSinging: (change: SingingChange) => post<SingingResult>('singing', change),
    saveCast: (change: CastChange) => post<CastResult>('cast', change),
    saveBeatCast: (change: BeatCastChange) => post<BeatCastResult>('beat-cast', change),
    storyForCast: (body: StoryForCast) => post<StoryResult>('book/for-cast', body),
    dropStoryProposal: () => post<{dropped: true}>('book/drop-proposal', {}),
    saveStory: (text: string) => post<StoryResult>('book', {text}),
    saveLook: (change: LookChange) => post<LookResult>('look', change),
    previewConfig: (change: ConfigChange) => post<ConfigImpact>('config', {change, dryRun: true}),
    saveConfig: (change: ConfigChange) => post<ConfigResult>('config', {change}),
    saveTiming: (change: TimingChange) => post<TimingResult>('timing', change),
    refineTiming: (language: RefinementLanguage, passage?: ConfirmedPassage) =>
      post<TimingRefinement>('timing-refine', {language, ...(passage ? {passage} : {})}),
    applyTimingRefinement: (id: string) => post<TimingResult>('timing-refine-apply', {id}),
    override: (clip: string, override: EditorOverride | null) => post<{written: true}>(`override/${id(clip)}`, override),
  }
}
