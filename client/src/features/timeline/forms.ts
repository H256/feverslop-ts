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

////////// POST-WORK: optional steps on a finished video (docs/postwork.md), each a command that writes a new video next to it
type FinalChoice = {file: string; label: string; preview: boolean}

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
export const CORNERS = [
  ['top-right', "Top right (the code's example)"],
  ['top-left', 'Top left'],
  ['bottom-right', 'Bottom right'],
  ['bottom-left', 'Bottom left'],
] as const

/** The AI marker over a finished video: what the project has set, changed in the form. */
export type LabelDraft = {
  from: string
  marker: string
  mode: ValueOf<typeof LABEL_MODES>
  seconds: number
  interval: number
  corner: ValueOf<typeof CORNERS>
  size: number
  margin: number
  save: boolean
  saveDefault: boolean
}
export const newLabel = (settings: PostworkView['label'], from: string): LabelDraft => ({
  from,
  marker: settings.marker,
  mode: settings.mode as LabelDraft['mode'],
  seconds: settings.seconds,
  interval: settings.interval,
  corner: settings.corner as LabelDraft['corner'],
  size: settings.size,
  margin: settings.margin,
  save: false,
  saveDefault: false,
})
/** The run for it: every value said, so the video is what the form shows whatever the settings say. */
export const labelRequest = (draft: LabelDraft): RunRequest => ({
  type: 'label',
  from: draft.from,
  marker: draft.marker.trim(),
  mode: draft.mode,
  seconds: Number(draft.seconds),
  interval: Number(draft.interval),
  corner: draft.corner,
  size: Number(draft.size),
  margin: Number(draft.margin),
  ...kept(draft),
})
/** Where the options are kept as well: the project's config.json, the settings file - or nowhere. */
const kept = (draft: {save: boolean; saveDefault: boolean}) => ({...(draft.save ? {save: true} : {}), ...(draft.saveDefault ? {saveDefault: true} : {})})

/** A clip in front of a finished video: its path - empty for input/intro.mp4 of the project - and the fade into the video. */
export type IntroDraft = {from: string; file: string; fade: number; save: boolean; saveDefault: boolean}
export const newIntro = (settings: PostworkView['intro'], from: string): IntroDraft => ({
  from,
  file: settings.file,
  fade: settings.fade,
  save: false,
  saveDefault: false,
})
/** The title card and the credits: the project's settings, changed in the form - the lines of your own one per line of a text box. */
export type CreditsDraft = {
  from: string
  opening: boolean
  end: boolean
  openingSeconds: number
  endSeconds: number
  title: string
  who: string
  disclosure: string
  marker: string
  extra: string
  hardware: string
  facts: boolean
  sound: string
  save: boolean
  saveDefault: boolean
}
export const newCredits = (settings: PostworkView['credits'], kind: 'music' | 'film', from: string): CreditsDraft => ({
  from,
  opening: settings.opening,
  end: settings.end,
  openingSeconds: settings.openingSeconds,
  endSeconds: settings.endSeconds,
  title: settings.title,
  who: kind === 'film' ? settings.director : settings.artist,
  disclosure: settings.disclosure,
  marker: settings.marker,
  extra: settings.extra.join('\n'),
  hardware: settings.hardware,
  facts: settings.facts,
  sound: settings.sound,
  save: false,
  saveDefault: false,
})
export const creditsRequest = (draft: CreditsDraft, kind: 'music' | 'film'): RunRequest => ({
  type: 'credits',
  from: draft.from,
  opening: draft.opening,
  end: draft.end,
  openingSeconds: Number(draft.openingSeconds),
  endSeconds: Number(draft.endSeconds),
  title: draft.title.trim(),
  ...(kind === 'film' ? {director: draft.who.trim()} : {artist: draft.who.trim()}),
  disclosure: draft.disclosure.trim(),
  marker: draft.marker.trim(),
  extra: draft.extra
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean),
  hardware: draft.hardware.trim(),
  facts: draft.facts,
  sound: draft.sound.trim(),
  ...kept(draft),
})
export const introRequest = (draft: IntroDraft): RunRequest => ({
  type: 'intro',
  from: draft.from,
  file: draft.file.trim(),
  fade: Number(draft.fade),
  ...kept(draft),
})

/** The YouTube text of a finished video (bun run description): the video is chosen by the user, nothing is picked for them. */
export type DescriptionDraft = {
  from: string
  story: boolean
  newStory: boolean
  facts: boolean
  hardware: string
  extra: string
  tags: string
  save: boolean
  saveDefault: boolean
}
export const newDescription = (settings: PostworkView['description']): DescriptionDraft => ({
  from: '',
  story: settings.story,
  newStory: false,
  facts: settings.facts,
  hardware: settings.hardware,
  extra: settings.extra.join('\n'),
  tags: settings.tags.join(' '),
  save: false,
  saveDefault: false,
})
export const descriptionRequest = (draft: DescriptionDraft): RunRequest => ({
  type: 'description',
  from: draft.from,
  story: draft.story,
  ...(draft.newStory ? {newStory: true} : {}),
  facts: draft.facts,
  hardware: draft.hardware.trim(),
  extra: draft.extra
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean),
  tags: draft.tags
    .split(/[\s,]+/)
    .map(tag => tag.replace(/^#/, ''))
    .filter(Boolean),
  ...kept(draft),
})
