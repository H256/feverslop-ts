import {shallowRef, type VNodeChild} from 'vue'
import {defineService} from './service'

/** A line of a question: one that is not there (false, 0, nothing) is left out. */
export type Line = string | false | 0 | null | undefined
export type AskOptions = {
  title: string,
  lines?: Line[],
  warnings?: Line[],
  confirm: string,
  danger?: boolean,
  /** GPU time: the render servers are chosen in the same question. */
  render?: boolean,
  /** A form of the question's own, made with h(); it reads into a reactive object of the caller. */
  body?: () => VNodeChild,
  /**
   * What the answer does, done while the question is still open: it closes once this is done, and a failure is said in it, with the
   * form as it was filled in. The question then answers true only when this succeeded.
   */
  submit?: () => Promise<unknown>,
}
export type AskRequest = AskOptions & {id: number, answer: (yes: boolean) => void}

/** Asking before anything that costs GPU time, drops planned work or moves a file: one question at a time, answered or cancelled. */
export function createAsk() {
  const current = shallowRef<AskRequest>()
  let next = 0
  const ask = (options: AskOptions) => new Promise<boolean>(resolve => {
    current.value?.answer(false)
    const request: AskRequest = {...options, id: next++, answer: yes => {
      if (current.value === request) current.value = undefined
      resolve(yes)
    }}
    current.value = request
  })
  return {current, ask}
}
export type Ask = ReturnType<typeof createAsk>
export const AskService = defineService<Ask>('ask')
export const useAsk = () => AskService.use().ask
