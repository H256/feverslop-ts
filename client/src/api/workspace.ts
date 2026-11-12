import type {
  EditorServer,
  Library,
  LibraryChange,
  ListingStatus,
  StatsView,
  MachineCheck,
  NewFilm,
  NewProject,
  SetupChange,
  SetupView,
  ProjectListing,
  RunInfo,
} from '../../../shared/workspace'
import {getJson, postForm, postJson} from './http'
import {projectRoot} from './urls'

/** What is not of one project: the start page, the library, the render servers. */
export const workspace = {
  projects: (signal?: AbortSignal) => getJson<{projects: ProjectListing[]}>('/api/projects', signal),
  status: (project: ProjectListing, signal?: AbortSignal) => getJson<ListingStatus>(`${projectRoot(project)}/api/status`, signal),
  servers: (signal?: AbortSignal) => getJson<{servers: EditorServer[]}>('/api/servers', signal),
  /** What `bun run doctor` says of this machine. */
  doctor: (signal?: AbortSignal) => getJson<{checks: MachineCheck[]}>('/api/doctor', signal),
  /** The servers of this machine: bun run setup show --json (#831). */
  setup: (signal?: AbortSignal) => getJson<SetupView>('/api/setup', signal),
  /** A change of them: bun run setup <command> --… */
  changeSetup: (change: SetupChange) => postJson<{said: string[]}>('/api/setup', change),
  /** A new music video, made by `bun run init` with these as its options. */
  createProject: (project: NewProject) => postJson<{id: string}>('/api/projects/new', project),
  /** A new film, made by `bun run film:init` with these as its options. */
  createFilm: (film: NewFilm) => postJson<{id: string}>('/api/films/new', film),
  library: (signal?: AbortSignal) => getJson<Library>('/api/library/assets', signal),
  /** What `bun run library rename|describe|remove` does (#835). */
  changeLibrary: (change: LibraryChange) => postJson<unknown>('/api/library/change', change),
  createAsset: (form: FormData) => postForm<{run: RunInfo}>('/api/library/create', form),
  libraryEvents: '/api/library/run-events',
  /** The measured times of this machine, as `bun run stats --json` reports them (#836). */
  stats: (filters: {since?: string; kind?: string}, signal?: AbortSignal) =>
    getJson<StatsView>(`/api/stats?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][])}`, signal),
}
