import type {PostworkView, RunRequest} from '../../../../shared/workspace'

// The forms of the timeline's questions: what can be chosen, as the values the CLI takes, and the request made from them.
type Choice = readonly (readonly [string, string])[]
type ValueOf<C extends Choice> = C[number][0]

export const REFINISH_PRESETS = [
  ['grade', 'Grade and sharpen only: no GPU'],
  ['smooth', '48 fps, grade and sharpen'],
  ['fullhd', 'Full HD by a refine pass, 48 fps, grade and sharpen'],
  ['custom', 'Say it one by one'],
] as const
export const UPSCALE = [['none', 'Not larger'], ['refine', 'Refine: second pass, denoise as below'], ['latent', 'Latent upscaler alone: fast, but artefacts'], ['model', 'Upscale model: RealESRGAN_x2plus']] as const
export const SIZE = [['fullhd', 'Full HD (1920×1088)'], ['2x', 'Twice the size']] as const
export const FPS = [['24', 'Stay at 24 fps'], ['48', '48 fps'], ['60', '60 fps']] as const

/** How a project is made over from the clips it has: a preset, or each step said by hand. */
export type Refinish = {
  preset: ValueOf<typeof REFINISH_PRESETS>, upscale: ValueOf<typeof UPSCALE>, size: ValueOf<typeof SIZE>,
  denoise: number, fps: ValueOf<typeof FPS>, finish: boolean,
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
export type NewView = {name: string, shows: string}

////////// POST-WORK: optional steps on a finished video (docs/postwork.md), each a command that writes a new video next to it
type FinalChoice = {file: string, label: string, preview: boolean}

/** The video a step starts from by default: the finished final video, else the final one - as the command takes it without --from. */
export function defaultSource(id: string, finals: FinalChoice[]): string | undefined {
  const names = finals.filter(f => !f.preview).map(f => f.file)
  return [`${id}-finished.mp4`, `${id}.mp4`].find(name => names.includes(name)) ?? names[0]
}

export const LABEL_MODES = [
  ['credits', 'At the start only: enough for an artistic or fictional work'],
  ['interval', 'At the start and again at an interval'],
  ['always', 'The whole time'],
] as const
export const CORNERS = [['top-right', 'Top right (the code\'s example)'], ['top-left', 'Top left'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left']] as const

/** The AI marker over a finished video: what the project has set, changed in the form. */
export type LabelDraft = {
  from: string, marker: string, mode: ValueOf<typeof LABEL_MODES>, seconds: number, interval: number,
  corner: ValueOf<typeof CORNERS>, size: number, margin: number, save: boolean,
}
export const newLabel = (settings: PostworkView['label'], from: string): LabelDraft => ({
  from, marker: settings.marker, mode: settings.mode as LabelDraft['mode'], seconds: settings.seconds, interval: settings.interval,
  corner: settings.corner as LabelDraft['corner'], size: settings.size, margin: settings.margin, save: false,
})
/** The run for it: every value said, so the video is what the form shows whatever the settings say. */
export const labelRequest = (draft: LabelDraft): RunRequest => ({
  type: 'label', from: draft.from, marker: draft.marker.trim(), mode: draft.mode, seconds: Number(draft.seconds), interval: Number(draft.interval),
  corner: draft.corner, size: Number(draft.size), margin: Number(draft.margin), ...(draft.save ? {save: true} : {}),
})
