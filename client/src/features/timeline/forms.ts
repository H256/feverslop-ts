import type {RunRequest} from '../../../../shared/workspace'

// The forms of the timeline's questions: what can be chosen, as the values the CLI takes, and the request made from them.
type Choice = readonly (readonly [string, string])[]
type ValueOf<C extends Choice> = C[number][0]

export const REFINISH_PRESETS = [
  ['grade', 'Grade and sharpen only: no GPU'],
  ['smooth', '48 fps, grade and sharpen'],
  ['fullhd', 'Full HD by a refine pass, 48 fps, grade and sharpen'],
  ['custom', 'Say it one by one'],
] as const
export const UPSCALE = [
  ['none', 'Not larger'],
  ['refine', 'Refine: second pass, denoise as below'],
  ['latent', 'Latent upscaler alone: fast, but artefacts'],
  ['model', 'Upscale model: RealESRGAN_x2plus'],
] as const
export const SIZE = [
  ['fullhd', 'Full HD (1920×1088)'],
  ['2x', 'Twice the size'],
] as const
export const FPS = [
  ['24', 'Stay at 24 fps'],
  ['48', '48 fps'],
  ['60', '60 fps'],
] as const

/** How a project is made over from the clips it has: a preset, or each step said by hand. */
export type Refinish = {
  preset: ValueOf<typeof REFINISH_PRESETS>
  upscale: ValueOf<typeof UPSCALE>
  size: ValueOf<typeof SIZE>
  denoise: number
  fps: ValueOf<typeof FPS>
  finish: boolean
}
export const newRefinish = (): Refinish => ({preset: 'grade', upscale: 'none', size: 'fullhd', denoise: 0.2, fps: '24', finish: true})
/** The run for it: a preset as it is, or every step; only the clips given, when some are. */
export function refinishRequest(form: Refinish, only: string[]): RunRequest {
  const clips = only.length ? {only} : {}
  return form.preset === 'custom'
    ? {type: 'refinish', upscale: form.upscale, size: form.size, denoise: Number(form.denoise), fps: Number(form.fps), finish: form.finish, ...clips}
    : {type: 'refinish', preset: form.preset, ...clips}
}

/** One more view of a place: where the camera is, and what it shows. */
export type NewView = {name: string; shows: string}
