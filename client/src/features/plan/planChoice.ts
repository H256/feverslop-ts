/** What the question before a plan run chose: a step to plan again from and - a film, with the shot plan - only some scenes (#836). */
export type PlanChoice = {redo: string; scenes: string[]}

/** The plan run of a choice - the same for its dry run and for the run itself. Scenes go only with the shot plan of a film. */
export function planAsked(choice: PlanChoice, until?: string): {redo?: string[]; until?: string; scenes?: string[]} {
  return {
    ...(choice.redo ? {redo: [choice.redo]} : {}),
    ...(until ? {until} : {}),
    ...(choice.redo === 'coverage' && choice.scenes.length ? {scenes: choice.scenes} : {}),
  }
}
