import {computed, nextTick, reactive, ref, type Ref} from 'vue'
import {useRouter} from 'vue-router'
import type {CastingRedo, CastingRole, CastingView, CastView} from '../../../../shared/workspace'
import {usePending} from '../../composables/usePending'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {listSteps} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useRunDock} from '../../services/run'
import {useToasts} from '../../services/toasts'
import type {useProject} from '../project/session'
import {castDraft, newMember, type CastDraft} from './forms'

type Project = ReturnType<typeof useProject>
export type CastingPageData = {casting: CastingView; cast: CastView | null; pending: CastingRedo}

/**
 * The cast by hand on the Casting page (#1007: out of the page, which held five dialog flows and their draft): the draft of names, roles
 * and props, the roles taken out on the list, the roles a film's screenplay is told anew for, and the save with its questions.
 */
export function useCastEditing({
  data,
  film,
  project,
  api,
  start,
  busy,
  root,
  refresh,
}: {
  data: Ref<CastingPageData | undefined>
  film: Ref<boolean>
  project: Project['project']
  api: Project['api']
  start: Project['start']
  busy: Project['busy']
  root: Project['root']
  refresh: () => Promise<unknown>
}) {
  const ask = useAsk()
  const toasts = useToasts()
  const run = useRunDock()
  const router = useRouter()
  // the story told anew for a changed cast is read on the Story page: there it waits when the run is done
  let toStory = false
  run.onEnd(() => {
    if (toStory) void router.push(`${root}/story`)
    toStory = false
  })

  // the cast by hand: names, roles and what they are, without the library - and for a music video who is in it at all
  const draft = ref<CastDraft>()
  const editing = computed(() => !!draft.value)
  const listOf = (kind: CastingRole['kind']) => (kind === 'character' ? 'characters' : 'locations')
  // roles taken out on the list of roles, not saved yet: marked on their cards, saved together with the bar below them (#588)
  const out = reactive(new Set<string>())
  const outKey = (kind: CastingRole['kind'], id: string) => `${kind}:${id}`
  const outCount = (kind: CastingRole['kind']) => [...out].filter(key => key.startsWith(`${kind}:`)).length
  /** The cast as a draft, without the roles taken out on the list. */
  const draftOf = (cast: CastView): CastDraft => {
    const d = castDraft(cast)
    // a film's roles taken out on the list go with the screenplay told anew, never with the cast by hand
    if (!film.value) for (const kind of ['character', 'location'] as const) d[listOf(kind)] = d[listOf(kind)].filter(m => !m.id || !out.has(outKey(kind, m.id)))
    return d
  }
  // the form takes over what was taken out on the list: it is then shown there, put back with one click
  const edit = (cast: CastView) => {
    draft.value = reactive(draftOf(cast))
    out.clear()
  }
  const cancel = () => {
    draft.value = undefined
  }
  // adding and removing start from the list of roles too (#588): the cast by hand opens with that change made, and is saved as any other
  const add = async (cast: CastView, kind: CastingRole['kind']) => {
    edit(cast)
    draft.value![listOf(kind)].push(newMember(kind))
    await nextTick()
    const names = document.querySelectorAll<HTMLInputElement>(`[data-cast="${kind}"] input[aria-label="Name"]`)
    names[names.length - 1]?.focus()
  }
  const remove = (role: CastingRole) => {
    out.add(outKey(role.kind, role.id))
  }
  const keep = (role: CastingRole) => {
    out.delete(outKey(role.kind, role.id))
  }
  const inCast = (cast: CastView, role: CastingRole) => cast[listOf(role.kind)].some(m => m.id === role.id && !m.group)
  // who is in the cast and not in the draft: taken out on save - said, and put back with one click
  const gone = computed(() => {
    const cast = data.value?.cast
    if (!cast || !draft.value) return []
    return (['character', 'location'] as const).flatMap(kind =>
      cast[listOf(kind)].filter(m => !draft.value![listOf(kind)].some(d => d.id === m.id)).map(member => ({kind, member})),
    )
  })
  const putBack = (kind: CastingRole['kind'], member: CastView['characters'][number]) => {
    draft.value![listOf(kind)].push({...member})
  }
  // a film: a role comes or goes with its screenplay told anew (#589) - added below the characters, taken out on the list, written by
  // the language model as a proposal on the Story page. Refused where the script is the user's
  const adapt = computed(() => (film.value ? data.value?.cast?.adapt : undefined))
  const canAdapt = computed(() => !!adapt.value && !adapt.value.refused)
  const newRoles = reactive<{name: string; role: string}[]>([])
  const addRole = async () => {
    newRoles.push({name: '', role: ''})
    await nextTick()
    const names = document.querySelectorAll<HTMLInputElement>('[data-cast="new-film-role"] input[aria-label="Name"]')
    names[names.length - 1]?.focus()
  }
  const removable = (cast: CastView, role: CastingRole) => (cast.canAdd || (canAdapt.value && role.kind === 'character')) && !busy.value && inCast(cast, role)
  const discard = () => {
    out.clear()
    newRoles.splice(0)
  }
  const tellAnew = toasts.guard(async () => {
    const add = newRoles.map(r => ({name: r.name.trim().replace(/\s+/g, ' '), role: r.role.trim().replace(/\s+/g, ' ')}))
    if (add.some(r => !r.name || !r.role)) throw new Error('every new role needs a name and who they are in the story')
    if (add.some(r => r.name.includes(':'))) throw new Error('a name without a colon, please')
    const gone = data.value!.casting.roles.filter(r => r.kind === 'character' && out.has(outKey(r.kind, r.id)))
    const dropped = adapt.value?.dropped ?? []
    const yes = await ask({
      title: 'Tell the screenplay anew for this cast?',
      lines: [
        [add.length && `new: ${add.map(r => r.name).join(', ')}`, gone.length && `gone: ${gone.map(r => r.name).join(', ')}`].filter(Boolean).join(' · '),
        'The language model writes the same scenes again with them: a part for whoever is new, nothing left of whoever goes. Nothing changes until you take it - it waits on the Story page next to the screenplay there is.',
      ],
      warnings: dropped.length
        ? [
            `Taking it drops what is read from the script: ${listSteps(dropped, project.value.kind)}. Who stays keeps their looks, the look of the film and the places stay.`,
          ]
        : [],
      confirm: 'Have it written',
    })
    if (!yes) return
    await start({type: 'adapt-story', add, remove: gone.map(r => r.id)})
    discard()
    toStory = true
  })
  useUnsavedChanges(() => editing.value || out.size > 0 || newRoles.length > 0, 'changes to the cast')
  const saving = usePending()

  /** The cast saved: the form, or - from the list of roles - the cast without the roles taken out there. */
  const saveCast = toasts.guard(async () => {
    const cast = data.value?.cast
    if (!cast || (!draft.value && !out.size)) return
    // from the list the page stays the list while it asks: the draft is made only to be sent
    const sending = draft.value ?? draftOf(cast)
    const yes = await ask({
      title: 'Save the cast?',
      lines: [
        !draft.value &&
          `Out of the cast: ${data
            .value!.casting.roles.filter(r => out.has(outKey(r.kind, r.id)))
            .map(r => r.name)
            .join(', ')}.`,
        'The cast in project.json is changed. Ids stay: a renamed role keeps its pictures and its entry in casting.json.',
        cast.builtOn.length
          ? 'The next plan run makes what goes again, from this cast: the language model only, nothing is rendered.'
          : 'Nothing is planned from the cast yet: the next stage is planned from this one.',
        cast.remakes.length > 0 && 'The looks of whoever is new or changed are written again; everyone else keeps theirs.',
      ],
      warnings: [
        cast.builtOn.length > 0 && `What is built on the cast goes: ${listSteps(cast.builtOn, project.value.kind)}.`,
        cast.builtOn.includes('singing') && 'Who sings which line is asked again - a choice made on the Singers page goes too.',
        project.value.clips.some(c => c.video) && 'Pictures and clips made before stay, and are stale once the plan has new prompts for them.',
        !film.value && 'The story still tells what it told: a role that is now someone else entirely is best changed in the story too (Story page).',
      ],
      confirm: 'Save it',
    })
    if (!yes) return
    // while saving the page is not to be changed: the draft sent is let go after it, and with it whatever was typed meanwhile
    const result = await saving.during(() => api.saveCast(sending))
    draft.value = undefined
    out.clear()
    toasts.show(result.changed ? 'The cast is saved' : 'Nothing changed')
    // the story still tells of the cast before: the new names put in, or the story told anew for whoever came or went
    if (
      !film.value &&
      result.renamed.length &&
      (await ask({
        title: 'The new names in the story too?',
        lines: [
          ...result.renamed.map(r => `${r.from} → ${r.to}`),
          'Replaced as whole words: the full name, and each of its words that changed. The cast and the looks stay.',
        ],
        confirm: 'Put them in',
      }))
    )
      await api.storyForCast({renamed: result.renamed})
    if (
      !film.value &&
      (result.added.length || result.removed.length) &&
      (await ask({
        title: 'Tell the story anew for this cast?',
        lines: [
          [result.added.length && `new: ${result.added.join(', ')}`, result.removed.length && `gone: ${result.removed.join(', ')}`].filter(Boolean).join(' · '),
          'The language model tells the same story with them. It waits on the Story page next to the story there is, to be taken or dropped.',
        ],
        confirm: 'Have it written',
      }))
    ) {
      await start({type: 'adapt-story'})
      toStory = true
      return
    }
    await refresh()
  })
  return {
    draft,
    editing,
    out,
    outKey,
    outCount,
    edit,
    cancel,
    add,
    remove,
    keep,
    inCast,
    gone,
    putBack,
    adapt,
    canAdapt,
    newRoles,
    addRole,
    removable,
    discard,
    tellAnew,
    saving,
    saveCast,
  }
}
