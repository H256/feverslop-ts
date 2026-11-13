import type {PlanStage, ProjectKind} from '../../../../shared/workspace'

/**
 * The preproduction, as a film is made: the book, then who plays and where, then the look, then the shots - each planned and looked at
 * before what is built on it, and all of it before anything is rendered. Every stage is the language model.
 */
export const STAGES: PlanStage[] = ['story', 'cast', 'look', 'plan']
export const stageName = (stage: PlanStage, kind: ProjectKind) =>
  ({story: kind === 'film' ? 'Screenplay' : 'Story', cast: 'Cast', look: 'Look', plan: 'Shot plan'})[stage]
/** The page of a stage, relative to the project: the shot plan is seen on the timeline. */
export const STAGE_PAGE: Record<PlanStage, string> = {story: 'story', cast: 'casting', look: 'look', plan: ''}
export const stageDoes = (stage: PlanStage, kind: ProjectKind) =>
  ({
    story: kind === 'film' ? 'The screenplay, from the idea or from the script.' : 'The story, from the lyrics and the story idea.',
    cast: kind === 'film' ? 'Who is in it and where it is, from the screenplay.' : 'Who is in it and where it is, from the story - and who sings which line.',
    look:
      kind === 'film'
        ? 'The look of the film, and how everyone, every place and every prop looks.'
        : 'The look of the video, and how everyone and every place looks.',
    plan: kind === 'film' ? 'The shots of every scene.' : 'The beats of the story on the song, and the shots of every clip.',
  })[stage]
/** The stages a plan run makes from `next` up to `until`, or up to the end. */
export function stagesBetween(next: PlanStage | undefined, until?: PlanStage) {
  const from = STAGES.indexOf(next ?? 'plan')
  const to = until ? STAGES.indexOf(until) : STAGES.length - 1
  return STAGES.slice(from, to + 1)
}

/**
 * The steps of each stage, by kind - the steps before the story are the song's. A step a changed input or setting makes again (`redo` in
 * `bun run status`) marks its stage as changed since it was planned (#833).
 */
export const STAGE_STEPS: Record<ProjectKind, Record<PlanStage, string[]>> = {
  music: {
    story: ['story', 'summary'],
    cast: ['cast', 'props', 'singing'],
    look: [
      'lookBrief',
      'characterLooks',
      'characterLookVariants',
      'characterDescriptionVariants',
      'locationLooks',
      'characterDescriptions',
      'locationDescriptions',
      'locationAnchors',
      'locationLayouts',
    ],
    plan: ['beats', 'timeline', 'mapping', 'propActivity', 'blocking', 'shotMoments', 'shotViews'],
  },
  film: {
    story: ['brief', 'outline', 'screenplay', 'scriptNotes', 'scriptFixes'],
    cast: ['cast', 'summary'],
    look: ['lookBrief', 'characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'locationViews', 'props'],
    plan: ['coverage'],
  },
}
/** The stages with a step the next run makes again. */
export const changedStages = (steps: {step: string; state: string}[], kind: ProjectKind): PlanStage[] =>
  STAGES.filter(stage => steps.some(s => s.state === 'redo' && STAGE_STEPS[kind][stage].includes(s.step)))
