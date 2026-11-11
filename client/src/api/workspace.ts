import type {EditorServer, Library, ListingStatus, MachineCheck, NewProject, ProjectListing, RunInfo} from '../../../shared/workspace'
import {getJson, postForm, postJson} from './http'
import {projectRoot} from './urls'

/** What is not of one project: the start page, the library, the render servers. */
export const workspace = {
  projects: (signal?: AbortSignal) => getJson<{projects: ProjectListing[]}>('/api/projects', signal),
  status: (project: ProjectListing, signal?: AbortSignal) => getJson<ListingStatus>(`${projectRoot(project)}/api/status`, signal),
  servers: (signal?: AbortSignal) => getJson<{servers: EditorServer[]}>('/api/servers', signal),
  /** What `bun run doctor` says of this machine. */
  doctor: (signal?: AbortSignal) => getJson<{checks: MachineCheck[]}>('/api/doctor', signal),
  /** A new music video, made by `bun run init` with these as its options. */
  createProject: (project: NewProject) => postJson<{id: string}>('/api/projects/new', project),
  library: (signal?: AbortSignal) => getJson<Library>('/api/library/assets', signal),
  createAsset: (form: FormData) => postForm<{run: RunInfo}>('/api/library/create', form),
  libraryEvents: '/api/library/run-events',
}
