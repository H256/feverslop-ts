import type {ProjectListing} from '../../../../shared/workspace'
import {matchesText} from '../../lib/search'

export const PAGE_SIZE = 24
export const KINDS = [{value: 'all', label: 'All'}, {value: 'music', label: 'Music videos'}, {value: 'film', label: 'Films'}] as const
export const STATES = [{value: 'all', label: 'Any state'}, {value: 'running', label: 'Running'}, {value: 'failed', label: 'Failed'}, {value: 'unfinished', label: 'Unfinished'}, {value: 'done', label: 'Done'}] as const
export type KindFilter = typeof KINDS[number]['value']
export type StateFilter = typeof STATES[number]['value']
export type ListFilter = {text: string, kind: KindFilter, state: StateFilter, page: number}

/** What a project's state counts as, for the filter: from what the list says, nothing is hashed for it. */
export function matchesState(project: ProjectListing, state: StateFilter) {
  switch (state) {
    case 'running': return project.lastRun?.state === 'running'
    case 'failed': return project.lastRun?.state === 'failed' || project.lastRun?.state === 'stopped'
    case 'unfinished': return !project.clips || project.rendered < project.clips || project.final !== 'current'
    case 'done': return project.clips > 0 && project.rendered === project.clips && project.final === 'current'
    default: return true
  }
}
export const matchesFilter = (project: ProjectListing, filter: ListFilter) =>
  (filter.kind === 'all' || project.kind === filter.kind) && matchesState(project, filter.state) && matchesText(filter.text, project.id, project.title)

/** The takes of one thing fold into the newest (the list comes newest first); a search shows every hit by itself. */
export function groupProjects(projects: ProjectListing[], expanded: ReadonlySet<string>, searching: boolean) {
  const entries: {project: ProjectListing, others: ProjectListing[]}[] = []
  const groups = new Map<string, typeof entries[number]>()
  for (const project of projects) {
    const group = groups.get(project.group)
    if (!searching && group && !expanded.has(project.group)) group.others.push(project)
    else {
      const entry = {project, others: [] as ProjectListing[]}
      entries.push(entry)
      groups.set(project.group, entry)
    }
  }
  return entries
}

const oneOf = <T extends string>(options: readonly {value: T}[], value: unknown, fallback: T): T => options.find(o => o.value === value)?.value ?? fallback
/** What is shown lives in the address: Back from a project lands in the same place, and a view can be linked. */
export function filterOf(query: Record<string, unknown>): ListFilter {
  return {
    text: typeof query.q === 'string' ? query.q : '',
    kind: oneOf(KINDS, query.kind, 'all'),
    state: oneOf(STATES, query.state, 'all'),
    page: Math.max(1, Math.floor(Number(query.page)) || 1),
  }
}
export function queryOf(filter: ListFilter): Record<string, string> {
  return {
    ...(filter.text ? {q: filter.text} : {}),
    ...(filter.kind !== 'all' ? {kind: filter.kind} : {}),
    ...(filter.state !== 'all' ? {state: filter.state} : {}),
    ...(filter.page > 1 ? {page: String(filter.page)} : {}),
  }
}
