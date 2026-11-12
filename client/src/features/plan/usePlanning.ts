import {h, reactive} from 'vue'
import type {PlanStage} from '../../../../shared/workspace'
import {plural} from '../../lib/format'
import {useAsk} from '../../services/ask'
import {useProject} from '../project/session'
import PlanQuestion from './PlanQuestion.vue'
import {type PlanChoice, planAsked} from './planChoice'
import {stageDoes, stageName, stagesBetween} from './stages'

/** The plan runs of the preproduction, each asked first: what it makes, and that it renders nothing. */
export function usePlanning() {
  const ask = useAsk()
  const {project, api, start} = useProject()

  /** Plans up to this stage, or everything (until undefined). */
  async function planStage(until?: PlanStage) {
    const {kind, plan} = project.value
    // what it would do, from the command's dry run, and a step to plan again from - a film: also the scenes whose shots are (#836)
    const draft = reactive<PlanChoice>({redo: '', scenes: []})
    const until_ = until && until !== 'plan' ? until : undefined
    const yes = await ask({
      title: until ? `Plan up to the ${stageName(until, kind).toLowerCase()}?` : plan.stage === 'plan' ? 'Plan again?' : 'Plan everything?',
      lines: [
        ...stagesBetween(plan.next, until).map(stage => `${stageName(stage, kind)}: ${stageDoes(stage, kind)}`),
        plan.stage
          ? 'The language model only. Nothing is rendered.'
          : 'The language model; a music video has its song read first (stems and the lyrics timing, when set). Nothing is rendered.',
        until ? 'It stops there: look at it here, change it, and go on.' : 'Rendering is asked for on the timeline afterwards.',
      ],
      body: () => h(PlanQuestion, {draft, until: until_, kind, api}),
      confirm: 'Plan it',
    })
    if (yes) await start({type: 'plan', ...planAsked(draft, until_)})
  }

  /** The casting photos of a music video planned up to the look: its characters and places rendered before the shots are planned. */
  async function renderLookPictures() {
    const missing = project.value.pictures.filter(p => !p.exists).length
    const asked = missing ? await api.estimatePictures(missing).catch(() => undefined) : undefined
    const yes = await ask({
      title: 'Render the pictures of the cast and the places?',
      lines: [
        'Every character and place as the look describes it, before the shots are planned - look at them on References, change a prompt there, render one again.',
        missing
          ? `${plural(missing, 'picture')} to render${asked?.estimate ? `: ${asked.estimate}` : ''}. Pictures already there stay.`
          : 'Every picture is there already: nothing is rendered.',
        'The members of a group come with the shot plan: how many there are is read from the beats.',
      ],
      confirm: 'Render them',
      render: true,
    })
    if (yes) await start({type: 'look-pictures'})
  }

  /** A plan run with nothing more to say than that it plans: what the Singers and Timing pages offer for unplanned beats. */
  const planNow = () => start({type: 'plan'})
  return {planStage, renderLookPictures, planNow}
}
