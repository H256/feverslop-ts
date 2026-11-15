<script setup lang="ts">
import CalloutBox from '../../components/CalloutBox.vue'
import {computed, h, reactive} from 'vue'
import type {CastingProp, CastingRole} from '../../../../shared/workspace'
import NoticeList from '../../components/NoticeList.vue'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import {listSteps, plural, stepNames} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useToasts} from '../../services/toasts'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import CastEditor from './CastEditor.vue'
import CastingRoleRow from './CastingRoleRow.vue'
import NewFilmRoles from './NewFilmRoles.vue'
import ReplacePicture from './ReplacePicture.vue'
import TakeAsset from './TakeAsset.vue'
import CastingPropRow from './CastingPropRow.vue'
import TakeProp from './TakeProp.vue'
import {useCastEditing} from './useCastEditing'

/** Who plays whom: a role given a library asset, or the cast changed by hand - two ways, never at once. */
const {project, api, start, busy, root} = useProject()
const ask = useAsk()
const toasts = useToasts()
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
/** A prop of the library for a character's prop (#944): `bun run import-asset … prop <id> --for=<character>`, asked first. */
const takeProp = toasts.guard(async (prop: CastingProp) => {
  const options = data.value?.casting.libraryProps ?? []
  const draft = reactive({choice: ''})
  const yes = await ask({
    title: `A prop of the library for ${prop.characterName}?`,
    lines: [
      `${prop.characterName}'s ${prop.name} becomes the prop of the library: its name, its description and its picture, copied here and pinned - nothing is rendered. The shots stay as they are planned.`,
    ],
    body: () => h(TakeProp, {draft, options, characterName: prop.characterName}),
    warnings: [
      prop.clips.length > 0 &&
        `The prop is in ${plural(prop.clips.length, 'clip')}: their requests change with the next plan run, and those rendered count as stale then.`,
      'A changed cast builds the props from its words again - the prop of the library is taken again then.',
    ],
    confirm: 'Take it',
    submit: async () => {
      if (!draft.choice) throw new Error('Choose a prop of the library.')
    },
  })
  if (yes) await start({type: 'import-prop', prop: draft.choice, character: prop.character})
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

const {
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
} = useCastEditing({data, film, project, api, start, busy, root, refresh})
</script>

<template>
  <div class="scrollpage view" :inert="saving.pending.value" :aria-busy="saving.pending.value">
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <template v-if="data">
      <CalloutBox v-if="changed && !editing" as="div" class="btn-row">
        <span>casting.json has changes the plan does not have yet: they take effect with the next plan run.</span>
        <button class="btn primary" :disabled="busy" @click="planNow">Plan now</button>
      </CalloutBox>
      <NoticeList :errors="data.casting.errors" :warnings="data.casting.warnings" />
      <div v-if="!data.cast" class="empty">No cast yet - plan it with the button above.</div>
      <template v-else-if="draft">
        <CalloutBox as="div">
          {{
            film
              ? "The names and texts of the screenplay's roles and places. Who is in it is the script's: a character added or taken out on the list of roles has the screenplay told anew."
              : 'Names, roles and props, and who is in it at all - without the library. Best right after the cast is planned: then nothing is built on it yet.'
          }}
        </CalloutBox>
        <CalloutBox v-if="gone.length" as="div" class="btn-row">
          <span>Out of the cast when saved:</span>
          <button v-for="{kind, member} in gone" :key="member.id" class="btn" :title="`Keep ${member.name} in the cast`" @click="putBack(kind, member)">
            Put back {{ member.name }}
          </button>
        </CalloutBox>
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
        <CalloutBox v-if="adapt?.refused" as="div">A role is added or taken out in the script: {{ adapt.refused }}.</CalloutBox>
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
        <div v-if="data.casting.props.length" class="section" data-props>
          <PageBar title="Props" />
          <p class="muted">Each prop has a picture of its own, laid into the clips its owner is in - the characters and the places are drawn without it.</p>
          <div class="role-grid">
            <CastingPropRow
              v-for="prop in data.casting.props"
              :key="prop.character"
              :prop="prop"
              :library="data.casting.libraryProps.length > 0"
              @take="takeProp(prop)"
            />
          </div>
        </div>
        <p v-else-if="!film && !data.casting.propPictures && data.cast.characters.some(c => c.prop)" class="muted">
          The props are drawn from their words in every clip. With Prop pictures on in the Settings each one gets a picture of its own.
        </p>
        <CalloutBox v-if="film && (out.size || newRoles.length)" as="div" class="castbar btn-row">
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
        </CalloutBox>
        <CalloutBox v-else-if="out.size" as="div" class="castbar btn-row">
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
        </CalloutBox>
      </template>
      <p class="muted">
        For a finished project, replacing a character in what is planned is the other way: bun run {{ film ? 'film:replace-character' : 'replace-character' }}
        {{ project.id }}
      </p>
    </template>
  </div>
</template>
