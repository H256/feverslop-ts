import type {AssetKind} from '../../../../shared/workspace'

/** What a new asset is made from: the picture, its kind and id, and what can be said of it. */
export type NewAsset = {file?: File, kind: AssetKind, id: string, name: string, role: string, description: string}
export const newAsset = (): NewAsset => ({kind: 'character', id: '', name: '', role: '', description: ''})

/** The form the server takes it as, with the render servers chosen in the question. */
export function assetForm(asset: NewAsset, servers: string[] | undefined) {
  const form = new FormData()
  form.set('anchor', asset.file ?? '')
  form.set('kind', asset.kind)
  form.set('id', asset.id.trim())
  form.set('name', asset.name)
  form.set('role', asset.role)
  form.set('description', asset.description)
  if (servers) form.set('servers', JSON.stringify(servers))
  return form
}
