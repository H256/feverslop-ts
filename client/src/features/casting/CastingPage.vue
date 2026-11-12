<script setup lang="ts">
import {computed, h, nextTick, reactive, ref} from 'vue'
import {useRouter} from 'vue-router'
import type {CastingRole, CastView} from '../../../../shared/workspace'
import NoticeList from '../../components/NoticeList.vue'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {usePending} from '../../composables/usePending'
import {useUnsavedChanges} from '../../composables/useUnsavedChanges'
import {listSteps, plural, stepNames} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useRunDock} from '../../services/run'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import CastEditor from './CastEditor.vue'
import CastingRoleRow from './CastingRoleRow.vue'
import NewFilmRoles from './NewFilmRoles.vue'
import ReplacePicture from './ReplacePicture.vue'
import TakeAsset from './TakeAsset.vue'
import {castDraft, newMember, type CastDraft} from './forms'

/** Who plays whom: a role given a library asset, or the cast changed by hand - two ways, never at once. */
const {project, api, start, busy, root} = useProject()
const ask = useAsk()
const toasts = useToasts()
const run = useRunDock()
const router = useRouter()
const film = computed(() => project.value.kind === 'film')
const {data, loading, error, reload, refresh} = usePageData(async signal => {
  const [casting, cast, pending] = await Promise.all([api.casting(signal), api.cast(signal), api.castingRedo(signal)])
  return {casting, cast: cast.cast, pending}
})
const rolesOf = (kind: CastingRole['kind']) => data.value?.casting.roles.filter(role => role.kind === kind) ?? []
const changed = computed(() => !!data.value?.pending.changes.length)

/** A role given another player: one entry in casting.json, asked first - what goes stale with it. */
async function choose(role: CastingRole, value: string, select: HTMLSelectElement) {
  const was = role.entry ?? `project:${role.id}`
  const asked = role.clips.length ? await api.estimateClips(role.clips).catch(() => undefined) : undefined
  const yes = await ask({
    title: `${role.name}: ${value}?`,
    lines: [
      'This changes one entry in casting.json. The next plan run copies the asset, pins it and takes its description.',
      asked?.estimate && `Rendering the clips again: ${asked.estimate}`,
    ],
    warnings: role.clips.length
      ? [
          `Their prompts change with the description, so ${plural(role.clips.length, 'clip')} go stale: ${role.clips.join(', ')}. Nothing is rendered on its own.`,
        ]
      : [],
    confirm: 'Change it',
  })
  if (!yes) {
    select.value = was
    return
  }
  try {
    await api.setCasting({kind: role.kind, id: role.id, value})
    toasts.show('casting.json is changed')
    await refresh()
  } catch (cause) {
    select.value = was
    toasts.fail(cause)
  }
}
/** A finished character or place of another music video taken over (#835): `bun run import-asset`, asked first. */
const takeFrom = toasts.guard(async (role: CastingRole) => {
  const {sources} = await api.assetSources(role.kind)
  if (!sources.length) {
    toasts.show(`No other music video has a finished ${role.kind === 'character' ? 'character' : 'place'} yet`)
    return
  }
  const same = sources.flatMap(s => s.assets.filter(a => a.id === role.id || a.name === role.name).map(a => `${s.project}/${a.id}`))[0]
  const draft = reactive({choice: same ?? '', description: 'source' as 'source' | 'vision' | 'keep'})
  const yes = await ask({
    title: `${role.name} from another project?`,
    lines: [
      'Its picture and its whole reference sheet are copied here and pinned - nothing is rendered. The pictures there are now are put away in old/attempts/.',
    ],
    body: () => h(TakeAsset, {draft, sources, role}),
    warnings: [
      role.clips.length > 0 &&
        `${role.name} is in ${plural(role.clips.length, 'clip')}: those rendered count as stale then; --render=videos --refresh=clips renders them again.`,
      'What was planned from the old description is said after the run, with the command that plans it again.',
    ],
    confirm: 'Take it over',
    submit: async () => {
      if (!draft.choice) throw new Error('Choose what is taken over.')
    },
  })
  if (!yes) return
  const [project, from] = draft.choice.split('/')
  await start({type: 'import-asset', asset: role.id, project: project!, from: from!, description: draft.description})
})
/** A picture of one's own for a character, in what is planned (#835): `bun run replace-character`, its dry run shown first. */
const replaceIn = toasts.guard(async (role: CastingRole) => {
  const draft = reactive({picture: '', describe: 'vision' as 'vision' | 'keep' | 'text', text: '', renderSheet: false})
  const description = () => (draft.describe === 'text' ? draft.text.trim() : draft.describe)
  const yes = await ask({
    title: `Replace the picture of ${role.name}?`,
    lines: ['The picture is put in, the reference sheet made from the old one goes. Clips already rendered stay as they are.'],
    body: () => h(ReplacePicture, {draft, dryRun: asked => api.replaceDryRun({character: role.id, ...asked})}),
    confirm: 'Replace it',
    submit: async () => {
      if (!draft.picture.trim()) throw new Error('The picture: the path of a file on this machine.')
      if (!description()) throw new Error('The description, or another choice.')
    },
  })
  if (!yes) return
  await start({type: 'replace-character', character: role.id, picture: draft.picture.trim(), description: description(), renderSheet: draft.renderSheet})
})
const chooseGuarded = (role: CastingRole, value: string, select: HTMLSelectElement) => {
  choose(role, value, select).catch(toasts.fail)
}

/** A changed casting.json: the run takes it over, and plans again what was planned from the old texts. */
const planNow = toasts.guard(async () => {
  const {changes, redo} = await api.castingRedo()
  // a plan stopped at a stage stays there: the cast is taken over, the next stage is asked for by itself
  const stage = project.value.plan.stage
  const until = stage && stage !== 'plan' ? stage : undefined
  const yes = await ask({
    title: 'Plan with this casting?',
    lines: [
      ...changes,
      redo.length
        ? `Planned again from the new texts: ${listSteps(redo, project.value.kind)}. The language model only, nothing is rendered.`
        : 'Nothing planned so far is built on the old texts: the run only takes the casting over. Nothing is rendered.',
    ],
    warnings:
      redo.length && project.value.clips.length ? ['Clips with these roles are stale afterwards. Rendering them again is asked for on the timeline.'] : [],
    confirm: 'Plan now',
  })
  if (yes) await start({type: 'plan', ...(redo.length ? {redo} : {}), ...(until ? {until} : {})})
})

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
</script>

<template>
  <div class="scrollpage view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <template v-if="data">
      <div v-if="changed && !editing" class="note btn-row">
        <span>casting.json has changes the plan does not have yet: they take effect with the next plan run.</span>
        <button class="btn primary" :disabled="busy" @click="planNow">Plan now</button>
      </div>
      <NoticeList :errors="data.casting.errors" :warnings="data.casting.warnings" />
      <div v-if="!data.cast" class="empty">No cast yet - plan it with the button above.</div>
      <template v-else-if="draft">
        <div class="note">
          {{
            film
              ? "The names and texts of the screenplay's roles and places. Who is in it is the script's: a character added or taken out on the list of roles has the screenplay told anew."
              : 'Names, roles and props, and who is in it at all - without the library. Best right after the cast is planned: then nothing is built on it yet.'
          }}
        </div>
        <div v-if="gone.length" class="note btn-row">
          <span>Out of the cast when saved:</span>
          <button v-for="{kind, member} in gone" :key="member.id" class="btn" :title="`Keep ${member.name} in the cast`" @click="putBack(kind, member)">
            Put back {{ member.name }}
          </button>
        </div>
        <CastEditor :members="draft.characters" title="Characters" kind="character" :film="film" :can-add="data.cast.canAdd" data-cast="character" />
        <CastEditor :members="draft.locations" title="Places" kind="location" :film="film" :can-add="data.cast.canAdd" data-cast="location" />
        <div class="section btn-row">
          <button class="btn primary" :disabled="busy" @click="saveCast">Save the cast</button>
          <button class="btn" @click="cancel">Cancel</button>
          <span v-if="data.cast.builtOn.length" class="muted" :title="stepNames(data.cast.builtOn)"
            >Saving drops what is built on the cast: {{ listSteps(data.cast.builtOn, project.kind) }}.</span
          >
        </div>
      </template>
      <template v-else>
        <div class="section btn-row">
          <button
            class="btn"
            :disabled="busy"
            :title="
              film ? 'Change names and what they are by hand' : 'Change names, roles and what they are by hand, add or remove someone - no library needed'
            "
            @click="edit(data.cast)"
          >
            {{ film ? 'Edit the roles and places' : 'Change the cast' }}
          </button>
          <span class="muted">Or give a role a library asset with the choice next to it.</span>
        </div>
        <div v-if="adapt?.refused" class="note">A role is added or taken out in the script: {{ adapt.refused }}.</div>
        <div
          v-for="[kind, title] in [
            ['character', 'Characters'],
            ['location', 'Places'],
          ] as const"
          v-show="rolesOf(kind).length || data.cast.canAdd"
          :key="kind"
          class="section"
        >
          <PageBar :title="title">
            <button v-if="data.cast.canAdd" class="btn" :disabled="busy" @click="add(data.cast, kind)">
              {{ kind === 'character' ? 'Add a character' : 'Add a place' }}
            </button>
            <button
              v-else-if="canAdapt && kind === 'character'"
              class="btn"
              :disabled="busy"
              title="A new role: the screenplay is told anew with them, as a proposal"
              @click="addRole"
            >
              Add a character
            </button>
          </PageBar>
          <div class="role-grid">
            <CastingRoleRow
              v-for="role in rolesOf(kind)"
              :key="role.id"
              :role="role"
              :options="data.casting.options[kind]"
              :removable="removable(data.cast, role)"
              :out="out.has(outKey(role.kind, role.id))"
              @choose="(value, select) => chooseGuarded(role, value, select)"
              @remove="remove(role)"
              @take="takeFrom(role)"
              @replace="replaceIn(role)"
              @put-back="keep(role)"
            />
          </div>
          <NewFilmRoles v-if="film && kind === 'character'" :roles="newRoles" />
        </div>
        <div v-if="film && (out.size || newRoles.length)" class="castbar note btn-row">
          <span
            >{{
              [newRoles.length && `New: ${plural(newRoles.length, 'character')}`, out.size && `out: ${plural(out.size, 'character')}`]
                .filter(Boolean)
                .join(', ')
            }}
            - the screenplay is told anew for them, as a proposal</span
          >
          <div class="spacer" />
          <button class="btn primary" :disabled="busy" @click="tellAnew">Tell the screenplay anew</button>
          <button class="btn" @click="discard">Discard</button>
        </div>
        <div v-else-if="out.size" class="castbar note btn-row">
          <span
            >Out of the cast when saved:
            {{
              [outCount('character') && plural(outCount('character'), 'character'), outCount('location') && plural(outCount('location'), 'place')]
                .filter(Boolean)
                .join(', ')
            }}</span
          >
          <div class="spacer" />
          <button class="btn primary" :disabled="busy" @click="saveCast">Save the cast</button>
          <button class="btn" @click="out.clear()">Discard</button>
        </div>
      </template>
      <p class="muted">
        For a finished project, replacing a character in what is planned is the other way: bun run {{ film ? 'film:replace-character' : 'replace-character' }}
        {{ project.id }}
      </p>
    </template>
  </div>
</template>
