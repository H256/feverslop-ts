import {shallowRef} from 'vue'
import {mediaUrl, type MediaRef, type MediaRoots} from '../api/urls'
import {defineService} from './service'

export type Viewed = {src: string, alt: string, caption: string, text?: string}

/** A picture large, with what it is: a reference, a frame, a view of a sheet. */
export function createViewer() {
  const shown = shallowRef<Viewed>()
  const open = (picture: MediaRef, roots: MediaRoots, title: string, name?: string, text?: string) => {
    shown.value = {src: mediaUrl(picture, roots), alt: name ?? title, caption: [title.replace(/[<>]/g, ''), name].filter(Boolean).join(' · '), text}
  }
  const close = () => { shown.value = undefined }
  return {shown, open, close}
}
export type Viewer = ReturnType<typeof createViewer>
export const ViewerService = defineService<Viewer>('viewer')
export const useViewer = ViewerService.use
