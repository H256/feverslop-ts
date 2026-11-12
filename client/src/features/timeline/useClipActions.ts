import {h, reactive} from 'vue'
import type {BeatCastResult, EditorClip, EditorOverride, LastRun, RunInfo, RunRequest} from '../../../../shared/workspace'
import BeatCastForm, {type BeatCastDraft} from './BeatCastForm.vue'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import AddViewForm from './AddViewForm.vue'
import {chain} from './clips'
import {newRefinish, refinishRequest, type NewView} from './forms'
import RefinishForm from './RefinishForm.vue'
import {finishSummary} from '../settings/settings'
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
        "Not proven yet: a two-pass job for a part has run out of the server's memory before, and taken the server down once.",
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
    // what the finish will do, as the settings have it - grain and colour match are set there
    const config = await api.config().catch(() => undefined)
    const finish = config && finishSummary(config.settings)
    await ask({
      title: 'Make this project over',
      lines: [
        'From the clips it has: no plan run, no new prompts. videos/ and the final video stay as they are; the clips of a variant get a folder of their own, its final videos a name of their own.',
        picked.length ? `Only the ${plural(picked.length, 'marked clip')}: larger clips, no final video.` : 'All clips, and the final videos.',
      ],
      warnings: ['Refine is slow - seconds per frame - and can change mouths a little: try a marked clip first, and compare.'],
      body: () => h(RefinishForm, {draft: form, finish, settings: `${session.root}/settings`}),
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
   * Who is in the marked clips (#765, #767): people of the cast or new ones joining it come in, others go out, with what they do
   * there as a direction rule. All clips of a beat count as the beat; some of them only, and the planner is told per shot who is
   * in it. The beats of the clips lose their shots and are planned by the next plan run - asked for right after, the language
   * model only.
   */
  async function bringPeople(clipIds: string[]) {
    const beats = (project.value.beats ?? []).filter(b => b.clips.some(id => clipIds.includes(id)))
    if (!beats.length) return
    const partial = beats.some(b => !b.clips.every(id => clipIds.includes(id)))
    const {cast} = await api.cast()
    const characters = cast?.characters ?? []
    const draft = reactive<BeatCastDraft>({characters: [], join: [{name: '', role: ''}], without: [], note: ''})
    let result: BeatCastResult | undefined
    const ids = characters.map(c => c.id)
    const yes = await ask({
      title: `Who is in ${plural(clipIds.length, 'clip')} of ${beats.map(b => b.id).join(', ')}`,
      lines: [
        'Characters of the cast, or new ones who join it. Each new person is a character of their own: their look is written and their picture rendered, everyone else keeps theirs.',
        partial
          ? 'Only some clips of a beat are marked: the beat gets the people, and the planner is told for each of its shots who is in it and who is not.'
          : '',
        `${beats.length === 1 ? 'This beat loses its shots and is' : `These ${beats.length} beats lose their shots and are`} planned again by the next plan run, with the people and the words below; the other beats keep their shots. Nothing is rendered here.`,
      ],
      body: () =>
        h(BeatCastForm, {
          draft,
          cast: characters,
          inAll: ids.filter(id => beats.every(b => b.characters.includes(id))),
          inSome: ids.filter(id => beats.some(b => b.characters.includes(id))),
        }),
      confirm: 'Save',
      submit: async () => {
        result = await api.saveBeatCast({
          clips: clipIds,
          characters: draft.characters,
          without: draft.without,
          join: draft.join.filter(j => j.name.trim() || j.role.trim()),
          note: draft.note,
        })
      },
    })
    if (!yes || !result) return
    marked.clear()
    const done = result
    const who = (list: {character: string}[]) => [...new Set(list.map(a => a.character))].join(', ')
    const now = await ask({
      title: `Plan ${done.beats.join(', ')} now?`,
      lines: [
        done.joined.length && `${done.joined.join(', ')} joined the cast: the plan run writes their look and description.`,
        done.added.length && `In: ${who(done.added)}.`,
        done.removed?.length && `Out: ${who(done.removed)}.`,
        `${plural(done.beats.length, 'beat')} planned again${done.rules ? `, with ${plural(done.rules, 'direction rule')} on who is where` : ''}. The language model only, no GPU.`,
        `Afterwards: ${done.joined.length ? 'the pictures of whoever joined on References, then ' : ''}"Render stale" for the clips of these beats.`,
      ],
      confirm: 'Plan now',
    })
    if (now) await start({type: 'plan'})
  }
  const plain = (action: RunRequest) => start(action)
  const plan = () => start({type: 'plan'})

  /**
   * After a render of clips that were there before: one is compared with what was there (side by side, nothing plays by itself);
   * several are marked - "Review" goes through them, nothing starts on its own.
   */
  async function afterRender(current: RunInfo | null, action: RunRequest | undefined) {
    if (current?.code || action?.type !== 'clips' || !action.again || action.preview) return
    const clips = project.value.clips.filter(c => action.ids.includes(c.id) && c.video)
    if (!clips.length) return
    if (clips.length > 1) {
      marked.clear()
      for (const clip of clips) marked.add(clip.id)
      return toasts.show(`${clips.length} clips rendered again and marked - Review goes through them`)
    }
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
    pickVersion: guarded(pickVersion),
    saveOverride: guarded(saveOverride),
    addView: guarded(addView),
    repeatLast: guarded(repeatLast),
    plain: guarded(plain),
    plan: guarded(plan),
    renderMarkedNow: renderMarked,
    afterRender,
  }
}
export type ClipActions = ReturnType<typeof useClipActions>
