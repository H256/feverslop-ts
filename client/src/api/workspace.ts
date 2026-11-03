import type {Library, ListingStatus, Media, ProjectKind, ProjectListing} from '../../../shared/workspace'

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {signal, headers: {Accept: 'application/json'}})
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined)
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const projectRoot = (project: {kind: ProjectKind, id: string}) => `/p/${project.kind}/${encodeURIComponent(project.id)}`
export function mediaUrl(media: Media, root: string, width?: number) {
  const query = new URLSearchParams({v: String(media.v)})
  if (width) query.set('w', String(width))
  return `${root}/${media.file.split('/').map(encodeURIComponent).join('/')}?${query}`
}
export const workspace = {
  projects: (signal: AbortSignal) => get<{projects: ProjectListing[]}>('/api/projects', signal),
  library: (signal: AbortSignal) => get<Library>('/api/library/assets', signal),
  status: (project: ProjectListing, signal: AbortSignal) => get<ListingStatus>(`${projectRoot(project)}/api/status`, signal),
}
