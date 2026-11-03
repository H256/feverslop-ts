import type {Page, Route} from '@playwright/test'
import type {
  BookView, CastingRedo, CastingView, CastView, EditorClip, EditorFreshness, EditorProject, EditorReference, LookView, ProjectStatus,
  SingingView, TimingView,
} from '../../../shared/workspace'

/** A small music video, made up: two clips, one rendered, one singer and one who could sing, one line with two words. */
const picture = {id: 'ann', label: '<Picture 1>', file: 'output/assets/ann.png', kind: 'character', name: 'Ann', subject: 'ann', description: 'Ann in a red coat', exists: true, v: 1}
const clip = (id: string, start: number, rendered: boolean): EditorClip => ({
  id, frameStart: start * 24, frames: 120, start, end: start + 5, group: 'verse-1',
  context: {label: 'Beat 1', text: 'Ann walks into the bar'},
  prompt: '<Picture 1> walks slowly', shots: [{label: '[Shot 1]', at: 0, framing: 'wide', camera: 'static', subjects: ['ann'], people: []}],
  lines: start ? [] : [{at: 1, end: 3, text: 'Hello night', who: 'Ann', line: 0}],
  pictures: [picture], audio: [], dropped: [], marks: [], refined: [],
  ...(rendered ? {video: {file: `videos/${id}.mp4`, v: 1, seed: 7}} : {}),
})
export const project: EditorProject = {
  id: 'demo', kind: 'music', title: 'Demo song', fps: 24, seconds: 10,
  groups: [{id: 'verse-1', label: 'Verse', start: 0, end: 10}],
  clips: [clip('clip-1', 0, true), clip('clip-2', 5, false)],
  pictures: [{id: 'ann', kind: 'character', name: 'Ann', file: 'output/assets/ann.png', exists: true, v: 1}],
  final: {state: 'missing'}, refinedVariants: [], finals: [], command: 'bun index.ts demo', sings: true, timed: true, plan: {stage: 'plan'},
}
const fresh: EditorFreshness = {clips: {'clip-1': 'current'}, pictures: {ann: 'current'}}
const status: ProjectStatus = {steps: [], changed: [], pictures: {total: 1, missing: 0, stale: 0}, clips: {total: 2, missing: 1, stale: 0}, final: 'missing', next: {command: 'bun index.ts demo --render=videos', why: 'Render 1 clip'}}
const book: BookView = {text: 'Once upon a time', editable: true, builtOn: ['summary'], keptByCast: [], stage: 'plan'}
const look: LookView = {lookBrief: 'Neon night', characters: [{kind: 'character', id: 'ann', name: 'Ann', look: 'red coat', description: 'a woman'}], locations: [], briefBuiltOn: [], builtOn: ['beats']}
const cast: CastView = {characters: [{id: 'ann', name: 'Ann', role: 'singer'}], locations: [{id: 'bar', name: 'Bar'}], canAdd: true, builtOn: [], remakes: []}
const casting: CastingView = {roles: [{kind: 'character', id: 'ann', name: 'Ann', copied: false, clips: ['clip-1'], errors: [], warnings: []}], errors: [], warnings: [], options: {character: ['kael'], location: []}}
const castingRedo: CastingRedo = {changes: [], redo: []}
const reference: EditorReference = {id: 'ann', kind: 'character', name: 'Ann', prompt: 'Ann in red', description: 'Ann', file: 'output/assets/ann.png', picture: {file: 'output/assets/ann.png', v: 1}, frames: [], hasSheet: false, looks: [], clips: ['clip-1'], versions: [], readsViews: false}
const words = [{text: 'Hello', start: 1, end: 2}, {text: 'night', start: 2, end: 3}]
const singing: SingingView = {
  singers: ['ann'],
  lines: [{line: 0, text: 'Hello night', section: 'Verse', start: 1, end: 3, singers: ['ann'], words, estimated: false, beats: ['beat-1'], clips: ['clip-1']}],
  characters: [{id: 'ann', name: 'Ann', beats: ['beat-1'], clips: ['clip-1']}, {id: 'ben', name: 'Ben', role: 'drummer', beats: [], clips: []}],
  beats: [{id: 'beat-1', characterIds: ['ann'], planned: true, clips: ['clip-1']}], unplanned: [],
}
const timing: TimingView = {
  duration: 10, lines: [{line: 0, section: 'Verse', text: 'Hello night', words, estimated: true, byHand: false, beats: ['beat-1']}],
  cuts: [{id: 'clip-1', start: 0, end: 5, beat: 'beat-1'}, {id: 'clip-2', start: 5, end: 10}], beats: [{id: 'beat-1', planned: true, clips: ['clip-1']}], unplanned: [],
}
const started = {run: {source: 'here', command: 'bun index.ts demo', pid: 1, startedAt: '2026-11-03T00:00:00Z', running: true}}

const GETS: Record<string, unknown> = {
  project, freshness: fresh, status, waveform: {peaks: null}, progress: {progress: null}, 'versions/clip-1': {versions: []}, 'versions/clip-2': {versions: []},
  references: {references: [reference]}, singing: {singing}, timing: {timing}, 'timing-wave': {peaks: null},
  casting, 'casting-redo': castingRedo, cast: {cast}, book, look,
}
const POSTS: Record<string, unknown> = {
  run: started, stop: {stopped: true}, estimate: {estimate: 'about 2 min', risks: []}, book: {changed: true, dropped: []},
  look: {changed: true, dropped: [], remade: []}, cast: {changed: true, dropped: [], remade: [], added: [], removed: [], renamed: []},
  casting: {written: true}, singing: {changed: [0], replanned: ['beat-1'], added: [], newSingers: ['ben'], formerSingers: [], staleClips: ['clip-1']},
  timing: {changed: [0], slots: ['clip-1'], replanned: [], staleClips: [], crossing: []}, 'references/ann/rerender': started,
}

export type Posted = {path: string, body: unknown}
/** The API of /p/music/demo answered from the fixtures; what the page posts is kept, in order. Media is not served: no pictures. */
export async function stubProject(page: Page) {
  const posted: Posted[] = []
  // as the server: a run started here is the one the events tell of
  let current: unknown = null
  await page.route(/\/p\/music\/demo\/api\//, async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/p\/music\/demo\/api\//, '')
    if (path === 'run-events') return route.fulfill({status: 200, headers: {'Content-Type': 'text/event-stream'}, body: `event: state\ndata: ${JSON.stringify(current)}\n\n`})
    if (request.method() === 'POST') {
      posted.push({path, body: request.postDataJSON()})
      if (path === 'run' || path.endsWith('/rerender')) current = started.run
      return route.fulfill({json: POSTS[path] ?? {}})
    }
    return path in GETS ? route.fulfill({json: GETS[path]}) : route.fulfill({status: 404, body: 'Not found'})
  })
  await page.route(/\/p\/music\/demo\/(media|thumb)\//, route => route.fulfill({status: 404, body: ''}))
  // one render server that can take a run, and one that is down: the question ticks only the first
  await page.route('**/api/servers', route => route.fulfill({json: {servers: [{name: 'gpu', reachable: true, running: 0, pending: 0}, {name: 'old', reachable: false, running: 0, pending: 0}]}}))
  return posted
}
