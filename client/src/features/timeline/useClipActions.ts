import {h, reactive} from 'vue'
import type {BeatCastResult, EditorClip, EditorOverride, LastRun, ProjectStatus, RunInfo, RunRequest} from '../../../../shared/workspace'
import BeatCastForm, {type BeatCastDraft} from './BeatCastForm.vue'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import AddViewForm from './AddViewForm.vue'
import {chain} from './clips'
import {creditsRequest, defaultSource, introRequest, labelRequest, newCredits, newIntro, newLabel, newRefinish, refinishRequest, type NewView} from './forms'
import CreditsForm from './CreditsForm.vue'
import IntroForm from './IntroForm.vue'
import LabelForm from './LabelForm.vue'
import RefinishForm from './RefinishForm.vue'
import type {Timeline} from './useTimeline'

/** What can be asked for on the timeline, each asked first - what it costs, what goes stale - and then run. */
export function useClipActions(timeline: Timeline) {
  const ask = useAsk()
  const toasts = useToasts()
  const {project, session, playback, marked, markedClips} = timeline
  const {api, start} = session
  const seedNote = (fixedSeed: number | undefined, what: string) =>
    fixedSeed !== undefined && `"seed" is fixed in config.json (${fixedSeed}): the same seed gives the same ${what} again.`
  const goesOn = (later: string[], what: string) =>
    later.length > 0 && `${later.join(', ')} go on from ${what}. They go stale and are not rendered on their own.`

  async function renderAgain(clip: EditorClip) {
    const asked = await api.estimateClips([clip.id]).catch(() => undefined)
    const yes = await ask({
      title: `Render ${clip.id}${clip.video ? ' again' : ''}?`,
      lines: [clip.video && 'A new seed. The version there now is put away and stays selectable.', asked?.estimate],
      warnings: [...(asked?.risks ?? []), seedNote(asked?.fixedSeed, 'clip'), goesOn(chain(project.value, clip), 'this clip')],
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
      warnings: [...(asked?.risks ?? []), seedNote(asked?.fixedSeed, 'clips'), goesOn(later, 'these clips')],
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
    if (project.value.kind === 'film' && clip.lines.some(line => line.at < to && (line.end ?? seconds) > from))
      throw new Error('A part with dialogue cannot be rendered on its own yet: the sound of a film comes with the picture.')
    const yes = await ask({
      title: `Render ${clip.id}: ${range} again?`,
      lines: [
        'Only this part, between the frames around it. The whole clip is put away first and stays selectable. The final video is not assembled on its own.',
      ],
      warnings: [
        'Not proven yet: on a 32 GB Radeon the two-pass job ran out of memory, and one try took the server down (#157).',
        to >= seconds - 0.05 &&
          clip.next &&
          `This part reaches the end of the clip: ${chain(project.value, clip).join(', ')} go on from its last frame and are marked.`,
      ],
      confirm: 'Render it anyway',
      render: true,
    })
    if (yes) await start({type: 'retake', clip: clip.id, range})
  }
  async function refinish() {
    const form = reactive(newRefinish())
    const picked = markedClips.value
    await ask({
      title: 'Make this project over',
      lines: [
        'From the clips it has: no plan run, no new prompts. videos/ and the final video stay as they are; the clips of a variant get a folder of their own, its final videos a name of their own.',
        picked.length ? `Only the ${plural(picked.length, 'marked clip')}: larger clips, no final video.` : 'All clips, and the final videos.',
      ],
      warnings: ['Refine is slow, about 6 s per frame on the Radeon, and can change mouths a little: try a marked clip first, and compare.'],
      body: () => h(RefinishForm, {draft: form}),
      confirm: 'Start',
      render: true,
      submit: () =>
        start(
          refinishRequest(
            form,
            picked.map(c => c.id),
          ),
        ),
    })
  }
  /** The finished videos a post-work step can start from: every final one but the low-resolution preview. */
  const sources = () => project.value.finals.filter(f => !f.preview)
  /** The AI marker over a finished video (bun run label): a new video next to it, nothing else changes. */
  async function label() {
    const from = defaultSource(project.value.id, project.value.finals)
    if (!from) throw new Error('There is no final video yet: render it first.')
    const {postwork} = project.value
    const form = reactive(newLabel(postwork.label, from))
    await ask({
      title: 'Put the AI marker on a video',
      lines: [
        'A marker in a corner of a finished video, written next to it as <name>-labeled.mp4. The video it is made from stays as it is; the sound is copied.',
        'Article 50(4) of the AI Act asks for it on a deep fake: real faces or voices made by AI. For an evidently artistic or fictional work, a marker at the start is enough.',
      ],
      warnings: [postwork.problem && `The post-work settings cannot be read, the defaults are shown: ${postwork.problem}`],
      body: () => h(LabelForm, {draft: form, finals: sources(), markers: postwork.markers}),
      confirm: 'Put it on',
      submit: () => start(labelRequest(form)),
    })
  }
  /** A clip in front of a finished video (bun run intro): a new video next to it, nothing else changes. */
  async function intro() {
    const from = defaultSource(project.value.id, project.value.finals)
    if (!from) throw new Error('There is no final video yet: render it first.')
    const {postwork} = project.value
    const form = reactive(newIntro(postwork.intro, from))
    await ask({
      title: 'Put an intro in front of a video',
      lines: [
        'A clip of your own - a logo, a channel ident - in front of a finished video, written next to it as <name>-intro.mp4. The video it is made from stays as it is.',
        'The intro takes the size and frame rate of the video; another aspect ratio gets black bars. An intro without sound gets silence.',
      ],
      warnings: [
        postwork.problem && `The post-work settings cannot be read, the defaults are shown: ${postwork.problem}`,
        !postwork.intro.file && !postwork.introFound && 'There is no input/intro.mp4 in this project: give the path of the intro.',
      ],
      body: () => h(IntroForm, {draft: form, finals: sources(), found: postwork.introFound}),
      confirm: 'Put it in front',
      submit: () => start(introRequest(form)),
    })
  }
  /** A title card before a finished video and the credits after it (bun run credits): a new video next to it. */
  async function credits() {
    const from = defaultSource(project.value.id, project.value.finals)
    if (!from) throw new Error('There is no final video yet: render it first.')
    const {postwork, kind} = project.value
    const form = reactive(newCredits(postwork.credits, kind, from))
    await ask({
      title: 'Add a title card and credits',
      lines: [
        'A title card before a finished video and scrolling credits after it, written next to it as <name>-credits.mp4. The video it is made from stays as it is.',
        'What it was made with - the language model, the models, the graphics cards - is collected from what this project ran; nothing is asked of a model. The run shows the credits line by line.',
      ],
      warnings: [postwork.problem && `The post-work settings cannot be read, the defaults are shown: ${postwork.problem}`],
      body: () => h(CreditsForm, {draft: form, finals: sources(), markers: postwork.markers, kind}),
      confirm: 'Add them',
      submit: () => start(creditsRequest(form, kind)),
    })
  }
  async function pickVersion(clip: EditorClip, version: {id: string; fromThisPlan?: boolean; source?: string}) {
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
    const location = clip.views.locationId
    await ask({
      title: 'One more view of this place',
      lines: ['For where the sheet has no view that fits. Rendered from the anchor of the place, so the look stays the same. It appears here to choose from.'],
      body: () => h(AddViewForm, {draft: view}),
      confirm: 'Render it',
      render: true,
      submit: () => start({type: 'add-view', location, name: view.name, shows: view.shows}),
    })
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
  /** The shots of these beats planned again with the planner as it is now (#762): the language model only, their clips go stale. */
  async function replanBeats(beatIds: string[]) {
    const all = project.value.beats ?? []
    const beats = all.filter(b => beatIds.includes(b.id))
    if (!beats.length) return
    const clips = beats.flatMap(b => b.clips)
    const yes = await ask({
      title: `Plan the shots of ${plural(beats.length, 'beat')} again?`,
      lines: [
        beats.map(b => b.id).join(', '),
        'The language model only, no GPU: new shots on the floor plans these beats have, with the planner as it is now. The other beats keep their shots.',
        `${plural(clips.length, 'clip')} go stale (${clips.join(', ')}). Render them afterwards with "Render stale"; the old versions stay selectable.`,
        'Edits made on the Direction page are applied to the new shots too.',
      ],
      warnings: [beats.length === all.length && 'These are all the beats: every clip of the video goes stale.'],
      confirm: 'Plan them again',
    })
    if (!yes) return
    await start({type: 'plan', beats: beats.map(b => b.id)})
    marked.clear()
  }
  /**
   * People brought into these beats (#765): of the cast, or new ones joining it, with what they do there as a direction rule. The
   * beats lose their shots and are planned by the next plan run - asked for right after, the language model only.
   */
  async function bringPeople(beatIds: string[]) {
    const beats = (project.value.beats ?? []).filter(b => beatIds.includes(b.id))
    if (!beats.length) return
    const {cast} = await api.cast()
    const characters = cast?.characters ?? []
    const draft = reactive<BeatCastDraft>({characters: [], join: [{name: '', role: ''}], note: ''})
    let result: BeatCastResult | undefined
    const yes = await ask({
      title: `Bring people into ${beats.map(b => b.id).join(', ')}`,
      lines: [
        'Characters of the cast, or new ones who join it. Each new person is a character of their own: their look is written and their picture rendered, everyone else keeps theirs.',
        `${beats.length === 1 ? 'This beat loses its shots and is' : `These ${beats.length} beats lose their shots and are`} planned again by the next plan run, with the people and the words below; the other beats keep their shots. Nothing is rendered here.`,
      ],
      body: () => h(BeatCastForm, {draft, cast: characters, inAll: characters.map(c => c.id).filter(id => beats.every(b => b.characters.includes(id)))}),
      confirm: 'Bring them in',
      submit: async () => {
        result = await api.saveBeatCast({
          beats: beats.map(b => b.id),
          characters: draft.characters,
          join: draft.join.filter(j => j.name.trim() || j.role.trim()),
          note: draft.note,
        })
      },
    })
    if (!yes || !result) return
    marked.clear()
    const done = result
    const now = await ask({
      title: `Plan ${done.beats.join(', ')} now?`,
      lines: [
        done.joined.length && `${done.joined.join(', ')} joined the cast: the plan run writes their look and description.`,
        `${plural(done.beats.length, 'beat')} planned again, with ${done.added.length ? [...new Set(done.added.map(a => a.character))].join(', ') : 'the people they had'}${done.rules ? ' and the note as a direction rule' : ''}. The language model only, no GPU.`,
        `Afterwards: ${done.joined.length ? 'the pictures of whoever joined on References, then ' : ''}"Render stale" for the clips of these beats.`,
      ],
      confirm: 'Plan now',
    })
    if (now) await start({type: 'plan'})
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
    renderAgain: guarded(renderAgain),
    renderMarked: guarded(renderMarked),
    replanBeats: guarded(replanBeats),
    bringPeople: guarded(bringPeople),
    preview: guarded(preview),
    retake: guarded(retake),
    refinish: guarded(refinish),
    label: guarded(label),
    intro: guarded(intro),
    credits: guarded(credits),
    pickVersion: guarded(pickVersion),
    saveOverride: guarded(saveOverride),
    addView: guarded(addView),
    repeatLast: guarded(repeatLast),
    runNext: guarded(runNext),
    plain: guarded(plain),
    plan: guarded(plan),
    renderMarkedNow: renderMarked,
    afterRender,
  }
}
export type ClipActions = ReturnType<typeof useClipActions>
