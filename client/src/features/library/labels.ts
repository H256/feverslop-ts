import type {LibraryEntry} from '../../../../shared/workspace'

export const assetKindLabel = (kind: LibraryEntry['kind']) => kind === 'character' ? 'Character' : 'Place'
