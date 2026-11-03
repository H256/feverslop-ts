import {onScopeDispose} from 'vue'

/** Title of the current view; restores the shell title when the view goes away. */
export function useDocumentTitle(title: string) {
  document.title = `${title} · Workspace`
  onScopeDispose(() => { document.title = 'Workspace' })
}
