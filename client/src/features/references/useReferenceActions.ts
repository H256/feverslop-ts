import {h, ref, type Ref} from 'vue'
import type {EditorReference} from '../../../../shared/workspace'
import FormField from '../../components/FormField.vue'
import {sameText} from '../../composables/useDraft'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useProject} from '../project/session'

const VERSION_SOURCE: Record<string, string> = {again: 'rendered again', stale: 'from an older plan', library: 'before the library took over'}
export const versionAbout = (version: EditorReference['versions'][number]) => [VERSION_SOURCE[version.source], version.seed !== undefined && `seed ${version.seed}`].filter(Boolean).join(' · ')

/**
 * What can be done with one reference picture, each asked first: render it again, take an older version back, put it into the library.
 * Only a picture played by the library is not rendered here: a pinned one - the user's own, or from an edited prompt - can be rendered
 * again, what is there is put away as an older version.
 */
export function useReferenceActions(reference: Ref<EditorReference>, done: () => Promise<unknown>) {
  const ask = useAsk()
  const {api, start, starter, takeServers} = useProject()
  const blocked = () => !!reference.value.library
  const sideEffects = () => [
    reference.value.clips.length > 0 && `${plural(reference.value.clips.length, 'clip')} made from this picture will go stale. They are not rendered on their own.`,
    reference.value.readsViews && 'A new sheet changes what is read from it: the vision model reads the views again at the next run, and shots can get another view.',
  ]

  /**
   * A new sheet from the same anchor, or a new anchor; an edited prompt is kept with this picture alone, which stays pinned. The plan's
   * prompt again unpins it: an anchor drawn from an edited prompt goes then too (lib/render.ts putAwayPicture).
   */
  async function rerender(newAnchor: boolean, prompt: string) {
    const r = reference.value
    const edited = !sameText(prompt, r.prompt)
    const back = !edited && r.editedPrompt !== undefined
    const anchorGoes = newAnchor || edited || back
    const asked = await api.estimatePictures(1).catch(() => undefined)
    const yes = await ask({
      title: `Render ${r.name} again?`,
      lines: [
        anchorGoes ? 'A new anchor: another person or place from another seed, and everything after it is new.' : 'A new sheet from the same anchor: the same person or place, other views.',
        asked?.estimate,
        edited && 'The edited prompt is kept with this picture, which stays pinned: the plan never replaces it on its own. The prompt of the plan stays as it was.',
        back && 'It is rendered from the plan\'s prompt again: the new picture is not pinned and follows the plan from then on.',
        !anchorGoes && r.ownAnchor && 'The new sheet is drawn from your own anchor.',
      ],
      warnings: [
        r.ownPicture && 'The picture is your own: it is put away as an older version and rendered anew from the prompt.',
        anchorGoes && r.ownAnchor && 'The anchor is your own: it is put away as an older version and drawn anew from the prompt.',
        ...sideEffects(),
        anchorGoes && r.looks.length > 0 && `Its other looks are drawn from this anchor and go stale too: ${r.looks.join(', ')}.`,
        asked?.fixedSeed !== undefined && `"seed" is fixed in config.json (${asked.fixedSeed}): the same seed gives the same picture again.`,
      ],
      confirm: 'Render it',
      render: true,
    })
    if (!yes) return
    const servers = takeServers()
    const started = starter()
    const {run} = await api.rerender(r.id, {newAnchor, ...(edited ? {prompt} : {}), ...(servers ? {servers} : {})})
    started(run)
  }
  async function pick(version: EditorReference['versions'][number]) {
    const yes = await ask({title: 'Make this version the current one?', lines: ['What is there now is put away and stays selectable.'], warnings: sideEffects(), confirm: 'Make it current'})
    if (!yes) return
    await api.pickReference(reference.value.id, version.id)
    await done()
  }
  async function putIntoLibrary() {
    const r = reference.value
    const as = ref(r.id)
    await ask({
      title: `Put ${r.name} into the library?`,
      lines: ['Its picture, its whole sheet and its texts are copied. An asset the library already has is never overwritten.'],
      body: () => h(FormField, {label: 'Library id'}, () => h('input', {type: 'text', required: true, value: as.value, onInput: (event: Event) => { as.value = (event.target as HTMLInputElement).value }})),
      confirm: 'Put it in',
      submit: () => start({type: 'export-asset', asset: r.id, as: as.value.trim()}),
    })
  }
  return {blocked, rerender, pick, putIntoLibrary}
}
