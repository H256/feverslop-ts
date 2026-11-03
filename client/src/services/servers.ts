import {shallowRef} from 'vue'
import type {EditorServer} from '../../../shared/workspace'
import {workspace} from '../api/workspace'
import {joined} from '../lib/format'
import {defineService} from './service'

const KEPT = 'servers'

export const serverLabel = (server: EditorServer) => !server.reachable ? `${server.name} down` : server.running || server.pending ? `${server.name} ${server.running}+${server.pending}` : server.name
export const serverLoad = (server: EditorServer) => joined([`${server.running} running, ${server.pending} waiting`, server.freeGb !== undefined && `${server.freeGb} GB free`])
export const serverTitle = (server: EditorServer) => server.reachable
  ? joined([server.device, server.freeGb !== undefined && `${server.freeGb} of ${server.totalGb} GB free`, `${server.running} running, ${server.pending} waiting`])
  : 'Not reachable'

/** The render servers: how busy they are, on every page, and which ones the next run may use - a choice kept in this browser. */
export function createServers() {
  const list = shallowRef<EditorServer[]>([])
  let chosen: string[] | undefined
  const refresh = async () => {
    try { list.value = (await workspace.servers()).servers } catch {}
  }
  const kept = (): string[] => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(KEPT) ?? '[]')
      return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []
    } catch {
      return []
    }
  }
  /** Those ticked when asked: the reachable ones kept from the last time, or all reachable ones. */
  const preselected = () => {
    const up = list.value.filter(server => server.reachable).map(server => server.name)
    const wanted = up.filter(name => kept().includes(name))
    return wanted.length ? wanted : up
  }
  const choose = (names: string[]) => {
    localStorage.setItem(KEPT, JSON.stringify(names))
    // none of them reachable: the run says so itself
    chosen = names.length ? names : undefined
  }
  /** The choice of the last question, for the run it was asked for: taken once. */
  const take = () => { const names = chosen; chosen = undefined; return names }
  return {list, refresh, preselected, choose, take}
}
export type Servers = ReturnType<typeof createServers>
export const ServersService = defineService<Servers>('servers')
export const useServers = ServersService.use
