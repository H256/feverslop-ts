import type {ProjectKind} from '../../../shared/workspace'

/** Where a project, or the library, serves its files from. */
export type MediaRoots = {media: string, thumb: string}
export type MediaRef = {file: string, v?: number}

export const projectRoot = (project: {kind: ProjectKind, id: string}) => `/p/${project.kind}/${encodeURIComponent(project.id)}`
export const rootsOf = (root: string): MediaRoots => ({media: `${root}/media`, thumb: `${root}/thumb`})
export const LIBRARY_ROOTS: MediaRoots = {media: '/library/media', thumb: '/library/thumb'}

const encoded = (file: string) => file.split('/').map(encodeURIComponent).join('/')
/** ?v= is the file's modification time: another version of it has another address. */
export const mediaUrl = ({file, v}: MediaRef, roots: MediaRoots) => `${roots.media}/${encoded(file)}${v ? `?v=${v}` : ''}`
export const thumbUrl = ({file, v}: MediaRef, roots: MediaRoots, width: 320 | 640 = 320) => `${roots.thumb}/${encoded(file)}?w=${width}${v ? `&v=${v}` : ''}`
