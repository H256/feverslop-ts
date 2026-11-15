/**
 * What the browser keeps for the viewer (#974): a private window, blocked site data or a full quota make every access throw - none of
 * these may break the page. Reading gives `null`, writing and removing do nothing; the value then holds for this visit only.
 */
type Area = 'localStorage' | 'sessionStorage'
const area = (name: Area): Storage | undefined => {
  try {
    return window[name]
  } catch {
    return undefined
  }
}
const make = (name: Area) => ({
  get(key: string): string | null {
    try {
      return area(name)?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      area(name)?.setItem(key, value)
    } catch {
      // kept for this visit only
    }
  },
  remove(key: string) {
    try {
      area(name)?.removeItem(key)
    } catch {
      // nothing kept, nothing to remove
    }
  },
})
export const viewerStore = make('localStorage')
export const keptThisSession = make('sessionStorage')

/**
 * Text to the clipboard. `navigator.clipboard` is only there on https and on localhost - the workspace opened over the LAN by http
 * has none (#987); then the old way through a hidden field. False when nothing worked, so the caller can say so.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the field below
  }
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.append(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
