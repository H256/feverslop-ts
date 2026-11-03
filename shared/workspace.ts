/** Browser-safe wire contracts. No runtime imports from the pipeline. */
export type ProjectKind = 'music' | 'film'
export type Media = {file: string, v: number}
export type ProjectListing = {
  id: string, kind: ProjectKind, title: string, group: string,
  clips: number, rendered: number, pictures: number, changed: number,
  final: 'missing' | 'current' | 'older', thumb?: Media,
  stage?: 'story' | 'cast' | 'look' | 'plan',
  lastRun?: {state: 'running' | 'stopped' | 'failed' | 'finished', command: string, startedAt: string, failures: string[], explained: {text: string, action: string}[]},
}
export type LibraryEntry = {
  kind: 'character' | 'location', id: string, name: string, description: string,
  anchors?: string, source?: string, created?: string,
  picture?: Media, anchor?: Media, video?: Media, frames: Media[],
  usedBy: {kind: ProjectKind, id: string, role: string}[],
}
export type Library = {dir: string, assets: LibraryEntry[]}
/** Only the status fields used by the listing; the API also returns step details. */
export type ListingStatus = {
  clips: {stale: number}, pictures: {stale: number},
  next: {command?: string, why: string, estimate?: string},
}
